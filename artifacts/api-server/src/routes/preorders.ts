import { Router, Request, Response } from "express";
import { db, preordersTable, paymentsTable, usersTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getSettings } from "../lib/settings.js";
import { sendPaymentWebhook } from "../lib/discord.js";
import crypto from "crypto";

const router = Router();

const NOWPAYMENTS_BASE = "https://api.nowpayments.io/v1";
const NOWPAYMENTS_CURRENCY_MAP: Record<string, string> = {
  BTC: "btc",
  LTC: "ltc",
  USDT: "usdttrc20",
};
const VALID_CURRENCIES = ["BTC", "LTC", "USDT"];

async function nowpaymentsRequest(path: string, options: RequestInit = {}) {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) throw new Error("NOWPAYMENTS_API_KEY not configured");
  const res = await fetch(`${NOWPAYMENTS_BASE}${path}`, {
    ...options,
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NOWPayments error ${res.status}: ${text}`);
  }
  return res.json();
}

async function getNowPaymentsMinAmount(currency: string): Promise<number> {
  try {
    const payCurrency = NOWPAYMENTS_CURRENCY_MAP[currency];
    const data = await nowpaymentsRequest(
      `/min-amount?currency_from=${payCurrency}&currency_to=usd&fiat_equivalent=usd`
    ) as { min_amount?: number; fiat_equivalent?: number };
    const minUsd = data.fiat_equivalent ?? data.min_amount ?? 0;
    return minUsd * 1.05;
  } catch {
    const FALLBACK: Record<string, number> = { BTC: 2, LTC: 2, USDT: 20 };
    return FALLBACK[currency] ?? 2;
  }
}

// GET /api/preorders — all paid/unfulfilled preorders + my entry
router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const allPreorders = await db
      .select()
      .from(preordersTable)
      .where(eq(preordersTable.status, "paid"))
      .orderBy(desc(preordersTable.amount));

    const userIds = [...new Set(allPreorders.map(p => p.userId))];
    const users: Record<string, { username: string; discordId: string; avatar: string | null }> = {};
    if (userIds.length) {
      const rows = await db.select({ id: usersTable.id, username: usersTable.username, discordId: usersTable.discordId, avatar: usersTable.avatar })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds));
      for (const u of rows) users[u.id] = { username: u.username, discordId: u.discordId, avatar: u.avatar };
    }

    const queue = allPreorders.map((p, i) => ({
      id: p.id,
      rank: i + 1,
      amount: parseFloat(p.amount),
      currency: p.currency,
      hoursRequested: p.hoursRequested ?? null,
      isOwn: p.userId === req.session.userId,
      username: users[p.userId]?.username ?? "Unknown",
      discordId: users[p.userId]?.discordId ?? "",
      avatar: users[p.userId]?.avatar ?? null,
      createdAt: p.createdAt.toISOString(),
    }));

    const myPreorder = queue.find(p => p.isOwn) ?? null;

    res.json({ queue, myPreorder });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch preorders");
    res.status(500).json({ error: "server_error" });
  }
});

// POST /api/preorders/create-stripe
router.post("/create-stripe", requireAuth, async (req: Request, res: Response) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(503).json({ error: "payment_unavailable", message: "Stripe is not configured" });
    return;
  }

  const existing = await db.select().from(preordersTable)
    .where(and(eq(preordersTable.userId, req.session.userId!), eq(preordersTable.status, "paid")))
    .limit(1);
  if (existing.length) {
    res.status(400).json({ error: "already_preordered", message: "You already have an active pre-order." });
    return;
  }

  const { pricePerDay, slotDurationHours, hourlyPricingEnabled, pricePerHour, minHours } = await getSettings();
  const { hours } = req.body as { hours?: number };

  let purchaseHours = slotDurationHours;
  let priceAmount = pricePerDay;

  if (hourlyPricingEnabled) {
    if (!hours || typeof hours !== "number" || !Number.isInteger(hours) || hours < minHours) {
      res.status(400).json({ error: "invalid_hours", message: `Hours must be a whole number of at least ${minHours}` });
      return;
    }
    purchaseHours = hours;
    priceAmount = pricePerHour * hours;
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey);

    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.BASE_URL || "http://localhost:80";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: Math.round(priceAmount * 100),
          product_data: {
            name: `Exe Joiner — Pre-order (${purchaseHours}h slot)`,
            description: `Pre-order a slot for the next available opening at $${priceAmount.toFixed(2)}`,
          },
        },
        quantity: 1,
      }],
      metadata: { userId: req.session.userId!, isPreorder: "true" },
      success_url: `${baseUrl}/dashboard?preorder=success`,
      cancel_url: `${baseUrl}/dashboard?preorder=cancelled`,
    });

    const paymentId = crypto.randomUUID();
    await db.insert(paymentsTable).values({
      id: paymentId,
      userId: req.session.userId!,
      slotNumber: 0,
      method: "preorder-stripe",
      status: "pending",
      amount: priceAmount.toFixed(2),
      usdAmount: priceAmount.toFixed(2),
      currency: "USD",
      stripeSessionId: session.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      derivationIndex: purchaseHours,
    });

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "Pre-order Stripe session creation failed");
    res.status(500).json({ error: "server_error", message: "Failed to create payment session" });
  }
});

// POST /api/preorders/create-crypto
router.post("/create-crypto", requireAuth, async (req: Request, res: Response) => {
  if (!process.env.NOWPAYMENTS_API_KEY) {
    res.status(503).json({ error: "payment_unavailable", message: "Crypto payments not configured" });
    return;
  }

  const { currency, hours } = req.body as { currency?: string; hours?: number };
  if (!currency || !VALID_CURRENCIES.includes(currency)) {
    res.status(400).json({ error: "invalid_currency", message: "Invalid currency. Supported: BTC, LTC, USDT (TRC20)" });
    return;
  }

  const existing = await db.select().from(preordersTable)
    .where(and(eq(preordersTable.userId, req.session.userId!), eq(preordersTable.status, "paid")))
    .limit(1);
  if (existing.length) {
    res.status(400).json({ error: "already_preordered", message: "You already have an active pre-order." });
    return;
  }

  const { pricePerDay, slotDurationHours, hourlyPricingEnabled, pricePerHour, minHours } = await getSettings();

  let purchaseHours = slotDurationHours;
  let priceAmount = pricePerDay;

  if (hourlyPricingEnabled) {
    if (!hours || typeof hours !== "number" || !Number.isInteger(hours) || hours < minHours) {
      res.status(400).json({ error: "invalid_hours", message: `Hours must be a whole number of at least ${minHours}` });
      return;
    }
    purchaseHours = hours;
    priceAmount = pricePerHour * hours;
  }

  const minUsd = await getNowPaymentsMinAmount(currency);
  if (minUsd > 0 && priceAmount < minUsd) {
    res.status(400).json({
      error: "below_minimum",
      message: `${currency === "USDT" ? "USDT TRC20" : currency} requires a minimum of $${minUsd.toFixed(2)} USD. Current price ($${priceAmount.toFixed(2)}) is too low.`,
    });
    return;
  }

  try {
    const paymentId = crypto.randomUUID();
    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.BASE_URL || "http://localhost:80";

    const nowPayment = await nowpaymentsRequest("/payment", {
      method: "POST",
      body: JSON.stringify({
        price_amount: priceAmount,
        price_currency: "usd",
        pay_currency: NOWPAYMENTS_CURRENCY_MAP[currency],
        ipn_callback_url: `${baseUrl}/api/payments/nowpayments-ipn`,
        order_id: paymentId,
        order_description: `Exe Joiner pre-order`,
      }),
    }) as { payment_id: string; pay_address: string; pay_amount: number };

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await db.insert(paymentsTable).values({
      id: paymentId,
      userId: req.session.userId!,
      slotNumber: 0,
      method: "preorder-crypto",
      status: "pending",
      currency,
      amount: String(nowPayment.pay_amount),
      usdAmount: priceAmount.toFixed(2),
      address: nowPayment.pay_address,
      txHash: nowPayment.payment_id,
      expiresAt,
      derivationIndex: purchaseHours,
    });

    res.json({ paymentId, address: nowPayment.pay_address, amount: String(nowPayment.pay_amount), currency, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Pre-order crypto session creation failed");
    res.status(500).json({ error: "server_error", message: "Failed to create crypto payment" });
  }
});

// POST /api/preorders/create-balance — pay for a pre-order using account balance
router.post("/create-balance", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;

  const existing = await db.select().from(preordersTable)
    .where(and(eq(preordersTable.userId, userId), eq(preordersTable.status, "paid")))
    .limit(1);
  if (existing.length) {
    res.status(400).json({ error: "already_preordered", message: "You already have an active pre-order." });
    return;
  }

  const { pricePerDay, slotDurationHours, hourlyPricingEnabled, pricePerHour, minHours } = await getSettings();
  const { hours } = req.body as { hours?: number };

  let purchaseHours = slotDurationHours;
  let priceAmount = pricePerDay;

  if (hourlyPricingEnabled) {
    if (!hours || typeof hours !== "number" || !Number.isInteger(hours) || hours < minHours) {
      res.status(400).json({ error: "invalid_hours", message: `Hours must be a whole number of at least ${minHours}` });
      return;
    }
    purchaseHours = hours;
    priceAmount = pricePerHour * hours;
  }

  try {
    const userRows = await db
      .select({ balance: usersTable.balance, username: usersTable.username, discordId: usersTable.discordId })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    const currentBalance = parseFloat(userRows[0]?.balance ?? "0");
    if (currentBalance < priceAmount) {
      res.status(400).json({
        error: "insufficient_balance",
        message: `Insufficient balance. Need $${priceAmount.toFixed(2)}, have $${currentBalance.toFixed(2)}`,
      });
      return;
    }

    await db.update(usersTable)
      .set({ balance: sql`${usersTable.balance} - ${priceAmount.toFixed(2)}::numeric`, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));

    const paymentId = crypto.randomUUID();
    await db.insert(preordersTable).values({
      userId,
      amount: priceAmount.toFixed(2),
      currency: "USD",
      paymentId,
      status: "paid",
      hoursRequested: purchaseHours,
    });

    await db.insert(paymentsTable).values({
      id: paymentId,
      userId,
      slotNumber: 0,
      method: "preorder-balance",
      status: "completed",
      amount: priceAmount.toFixed(2),
      usdAmount: priceAmount.toFixed(2),
      currency: "USD",
      derivationIndex: purchaseHours,
    });

    try {
      if (userRows[0]) {
        await sendPaymentWebhook({
          username: userRows[0].username,
          discordId: userRows[0].discordId,
          method: "balance",
          currency: "USD",
          amount: priceAmount.toFixed(2),
          purchaseType: "preorder",
        });
      }
    } catch (webhookErr) {
      req.log.warn({ webhookErr }, "Preorder balance webhook failed");
    }

    res.json({ success: true, newBalance: (currentBalance - priceAmount).toFixed(2) });
  } catch (err) {
    req.log.error({ err }, "Pre-order balance payment failed");
    res.status(500).json({ error: "server_error", message: "Failed to process balance payment" });
  }
});

// POST /api/preorders/verify-crypto — check NOWPayments status and confirm a crypto preorder
router.post("/verify-crypto", requireAuth, async (req: Request, res: Response) => {
  const { paymentId } = req.body as { paymentId?: string };
  if (!paymentId) {
    res.status(400).json({ error: "invalid_request", message: "paymentId required" });
    return;
  }

  try {
    const payments = await db
      .select()
      .from(paymentsTable)
      .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.userId, req.session.userId!)))
      .limit(1);

    if (!payments.length) {
      res.status(404).json({ error: "not_found", message: "Payment not found" });
      return;
    }

    const payment = payments[0];

    if (payment.status === "completed") {
      res.json({ success: true, message: "Payment already confirmed" });
      return;
    }

    if (payment.expiresAt && payment.expiresAt < new Date()) {
      res.status(400).json({ error: "expired", message: "Payment session has expired" });
      return;
    }

    if (!payment.txHash) {
      res.status(400).json({ error: "invalid_payment", message: "No NOWPayments reference found" });
      return;
    }

    const nowStatus = await nowpaymentsRequest(`/payment/${payment.txHash}`) as { payment_status: string };
    const CONFIRMED = new Set(["finished", "confirmed", "complete", "partially_paid"]);
    if (!CONFIRMED.has(nowStatus.payment_status)) {
      res.status(402).json({
        error: "not_confirmed",
        message: `Payment status: ${nowStatus.payment_status}. Please wait and try again.`,
      });
      return;
    }

    const existing = await db
      .select()
      .from(preordersTable)
      .where(and(eq(preordersTable.userId, req.session.userId!), eq(preordersTable.status, "paid")))
      .limit(1);
    if (existing.length) {
      res.status(400).json({ error: "already_preordered", message: "You already have an active pre-order." });
      return;
    }

    await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, payment.id));
    await db.insert(preordersTable).values({
      userId: payment.userId,
      amount: payment.amount ?? "0",
      currency: payment.currency ?? "USD",
      paymentId: payment.id,
      status: "paid",
      hoursRequested: payment.derivationIndex ?? null,
    });

    try {
      const userRows = await db.select({ username: usersTable.username, discordId: usersTable.discordId })
        .from(usersTable).where(eq(usersTable.id, payment.userId)).limit(1);
      if (userRows[0]) {
        await sendPaymentWebhook({
          username: userRows[0].username,
          discordId: userRows[0].discordId,
          method: "crypto",
          currency: payment.currency ?? undefined,
          amount: payment.amount ?? undefined,
          purchaseType: "preorder",
        });
      }
    } catch (webhookErr) {
      req.log.warn({ webhookErr }, "Preorder verify webhook failed");
    }

    res.json({ success: true, message: "Pre-order confirmed!" });
  } catch (err) {
    req.log.error({ err }, "Preorder crypto verification failed");
    res.status(500).json({ error: "server_error", message: "Verification failed" });
  }
});

export default router;
