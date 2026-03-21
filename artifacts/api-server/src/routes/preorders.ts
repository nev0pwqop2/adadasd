import { Router, Request, Response } from "express";
import { db, preordersTable, paymentsTable, usersTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getSettings } from "../lib/settings.js";
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

  const { pricePerDay, slotDurationHours } = await getSettings();

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
          unit_amount: Math.round(pricePerDay * 100),
          product_data: {
            name: `Exe Joiner — Pre-order (${slotDurationHours}h slot)`,
            description: `Pre-order a slot for the next available opening at $${pricePerDay.toFixed(2)}`,
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
      amount: pricePerDay.toFixed(2),
      currency: "USD",
      stripeSessionId: session.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      derivationIndex: slotDurationHours,
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

  const { currency } = req.body;
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

  const { pricePerDay, slotDurationHours } = await getSettings();
  const minUsd = await getNowPaymentsMinAmount(currency);
  if (minUsd > 0 && pricePerDay < minUsd) {
    res.status(400).json({
      error: "below_minimum",
      message: `${currency === "USDT" ? "USDT TRC20" : currency} requires a minimum of $${minUsd.toFixed(2)} USD. Current price ($${pricePerDay.toFixed(2)}) is too low.`,
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
        price_amount: pricePerDay,
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
      address: nowPayment.pay_address,
      txHash: nowPayment.payment_id,
      expiresAt,
      derivationIndex: slotDurationHours,
    });

    res.json({ paymentId, address: nowPayment.pay_address, amount: String(nowPayment.pay_amount), currency, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Pre-order crypto session creation failed");
    res.status(500).json({ error: "server_error", message: "Failed to create crypto payment" });
  }
});

export default router;
