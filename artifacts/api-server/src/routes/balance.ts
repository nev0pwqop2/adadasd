import { Router, Request, Response } from "express";
import { db, paymentsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getSettings } from "../lib/settings.js";
import { isLuarmorConfigured, createLuarmorUser } from "../lib/luarmor.js";
import { sendPaymentWebhook } from "../lib/discord.js";
import crypto from "crypto";

const router = Router();

const NOWPAYMENTS_BASE = "https://api.nowpayments.io/v1";

async function nowpaymentsRequest(path: string, options: RequestInit = {}) {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) throw new Error("NOWPAYMENTS_API_KEY not configured");
  const res = await fetch(`${NOWPAYMENTS_BASE}${path}`, {
    ...options,
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NOWPayments error ${res.status}: ${text}`);
  }
  return res.json();
}

const NOWPAYMENTS_CURRENCY_MAP: Record<string, string> = {
  BTC: "btc",
  LTC: "ltc",
  USDT: "usdttrc20",
};

const VALID_CURRENCIES = ["BTC", "LTC", "USDT"];

// GET /api/balance — get current balance
router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({ balance: usersTable.balance })
      .from(usersTable)
      .where(eq(usersTable.id, req.session.userId!))
      .limit(1);
    const balance = rows[0]?.balance ?? "0.00";
    res.json({ balance, balanceNum: parseFloat(balance) });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch balance");
    res.status(500).json({ error: "server_error" });
  }
});

// POST /api/balance/deposit/stripe — create Stripe checkout to add funds
router.post("/deposit/stripe", requireAuth, async (req: Request, res: Response) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(503).json({ error: "payment_unavailable", message: "Stripe not configured" });
    return;
  }

  const { amount } = req.body as { amount?: number };
  if (!amount || amount < 1 || amount > 10000) {
    res.status(400).json({ error: "invalid_amount", message: "Amount must be between $1 and $10,000" });
    return;
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey);
    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.BASE_URL || "http://localhost:80";
    const unitAmount = Math.round(amount * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            product_data: { name: "Exe Joiner — Balance Deposit", description: `Add $${amount.toFixed(2)} to your account balance` },
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: req.session.userId!,
        type: "balance_deposit",
      },
      success_url: `${baseUrl}/dashboard?deposit=success`,
      cancel_url: `${baseUrl}/dashboard?tab=deposit`,
    });

    const paymentId = crypto.randomUUID();
    await db.insert(paymentsTable).values({
      id: paymentId,
      userId: req.session.userId!,
      slotNumber: 0,
      method: "balance-deposit-stripe",
      status: "pending",
      amount: amount.toFixed(2),
      currency: "USD",
      stripeSessionId: session.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "Balance Stripe session failed");
    res.status(500).json({ error: "server_error", message: "Failed to create payment session" });
  }
});

// POST /api/balance/deposit/crypto — create NOWPayments payment to add funds
router.post("/deposit/crypto", requireAuth, async (req: Request, res: Response) => {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "payment_unavailable", message: "NOWPayments not configured" });
    return;
  }

  const { currency, amount } = req.body as { currency?: string; amount?: number };
  if (!currency || !VALID_CURRENCIES.includes(currency)) {
    res.status(400).json({ error: "invalid_currency" });
    return;
  }
  if (!amount || amount < 1 || amount > 10000) {
    res.status(400).json({ error: "invalid_amount", message: "Amount must be between $1 and $10,000" });
    return;
  }

  try {
    const paymentId = crypto.randomUUID();
    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.BASE_URL || "http://localhost:80";
    const ipnCallbackUrl = `${baseUrl}/api/payments/nowpayments-ipn`;
    const nowCurrency = NOWPAYMENTS_CURRENCY_MAP[currency];

    let minAmount = 2;
    try {
      const minData = await nowpaymentsRequest(`/min-amount?currency_from=usd&currency_to=${nowCurrency}`);
      if (minData?.min_amount) minAmount = parseFloat(minData.min_amount) * 1.05;
    } catch {}

    if (amount < minAmount) {
      res.status(400).json({ error: "below_minimum", minAmount });
      return;
    }

    const nowPayment = await nowpaymentsRequest("/payment", {
      method: "POST",
      body: JSON.stringify({
        price_amount: amount,
        price_currency: "usd",
        pay_currency: nowCurrency,
        order_id: paymentId,
        ipn_callback_url: ipnCallbackUrl,
      }),
    });

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.insert(paymentsTable).values({
      id: paymentId,
      userId: req.session.userId!,
      slotNumber: 0,
      method: "balance-deposit-crypto",
      status: "pending",
      currency,
      amount: amount.toFixed(2),
      address: nowPayment.pay_address,
      expiresAt,
    });

    res.json({
      paymentId,
      address: nowPayment.pay_address,
      amount: nowPayment.pay_amount,
      currency: nowPayment.pay_currency,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Balance crypto deposit failed");
    res.status(500).json({ error: "server_error", message: "Failed to create crypto payment" });
  }
});

// POST /api/balance/use — buy a slot using account balance
router.post("/use", requireAuth, async (req: Request, res: Response) => {
  const { slotNumber, hours } = req.body as { slotNumber?: number; hours?: number };

  if (slotNumber === undefined || slotNumber < 1) {
    res.status(400).json({ error: "invalid_slot" });
    return;
  }

  try {
    const settings = await getSettings();
    const { pricePerDay, pricePerHour, hourlyPricingEnabled, minHours, slotDurationHours } = settings;

    let chargeAmount: number;
    let purchasedHours: number;

    if (hourlyPricingEnabled) {
      const h = Math.max(minHours, hours ?? minHours);
      chargeAmount = h * pricePerHour;
      purchasedHours = h;
    } else {
      chargeAmount = pricePerDay;
      purchasedHours = slotDurationHours;
    }

    const userId = req.session.userId!;

    const userRows = await db
      .select({ balance: usersTable.balance })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    const currentBalance = parseFloat(userRows[0]?.balance ?? "0");

    if (currentBalance < chargeAmount) {
      res.status(400).json({ error: "insufficient_balance", message: `Insufficient balance. Need $${chargeAmount.toFixed(2)}, have $${currentBalance.toFixed(2)}` });
      return;
    }

    // Check slot is free
    const { slotsTable } = await import("@workspace/db");
    const slotRows = await db.select().from(slotsTable).where(eq(slotsTable.slotNumber, slotNumber)).limit(1);
    if (slotRows.length && slotRows[0].isActive) {
      res.status(409).json({ error: "slot_taken", message: "Slot is already taken" });
      return;
    }

    // Deduct balance atomically
    await db.update(usersTable)
      .set({ balance: sql`${usersTable.balance} - ${chargeAmount.toFixed(2)}::numeric`, updatedAt: new Date() })
      .where(and(eq(usersTable.id, userId)));

    // Create completed payment record
    const paymentId = crypto.randomUUID();
    await db.insert(paymentsTable).values({
      id: paymentId,
      userId,
      slotNumber,
      method: "balance",
      status: "completed",
      amount: chargeAmount.toFixed(2),
      currency: "USD",
      derivationIndex: hourlyPricingEnabled ? purchasedHours : null,
    });

    // Activate slot
    const durationMs = hourlyPricingEnabled
      ? purchasedHours * 60 * 60 * 1000
      : slotDurationHours * 60 * 60 * 1000;

    const expiresAt = new Date(Date.now() + durationMs);

    if (slotRows.length) {
      await db.update(slotsTable).set({
        userId,
        isActive: true,
        activatedAt: new Date(),
        expiresAt,
        paymentId,
        updatedAt: new Date(),
      }).where(eq(slotsTable.slotNumber, slotNumber));
    } else {
      await db.insert(slotsTable).values({
        slotNumber,
        userId,
        isActive: true,
        activatedAt: new Date(),
        expiresAt,
        paymentId,
      });
    }

    // Luarmor
    if (isLuarmorConfigured()) {
      try {
        await createLuarmorUser(userId, slotNumber, expiresAt);
      } catch (e) {
        req.log.warn({ e }, "Luarmor user creation failed (balance payment)");
      }
    }

    // Discord webhook
    try {
      await sendPaymentWebhook(userId, slotNumber, chargeAmount, "balance", purchasedHours);
    } catch {}

    res.json({ success: true, slotNumber, expiresAt: expiresAt.toISOString(), balance: (currentBalance - chargeAmount).toFixed(2) });
  } catch (err) {
    req.log.error({ err }, "Buy with balance failed");
    res.status(500).json({ error: "server_error", message: "Failed to purchase slot" });
  }
});

export default router;
