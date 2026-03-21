import { Router, Request, Response } from "express";
import { db, slotsTable, paymentsTable, usersTable, preordersTable } from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getSettings } from "../lib/settings.js";
import { isLuarmorConfigured, createLuarmorUser } from "../lib/luarmor.js";
import { sendPaymentWebhook } from "../lib/discord.js";
import crypto from "crypto";

const router = Router();

const VALID_CURRENCIES = ["BTC", "LTC", "USDT"];

const NOWPAYMENTS_CURRENCY_MAP: Record<string, string> = {
  BTC: "btc",
  LTC: "ltc",
  USDT: "usdttrc20",
};

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

async function createNowPaymentsPayment(
  orderId: string,
  usdAmount: number,
  currency: string,
  ipnCallbackUrl: string
): Promise<{ payment_id: string; pay_address: string; pay_amount: number; pay_currency: string }> {
  return nowpaymentsRequest("/payment", {
    method: "POST",
    body: JSON.stringify({
      price_amount: usdAmount,
      price_currency: "usd",
      pay_currency: NOWPAYMENTS_CURRENCY_MAP[currency],
      ipn_callback_url: ipnCallbackUrl,
      order_id: orderId,
      order_description: `Exe Joiner slot activation`,
    }),
  });
}

async function getNowPaymentsStatus(nowpaymentsPaymentId: string): Promise<{ payment_status: string }> {
  return nowpaymentsRequest(`/payment/${nowpaymentsPaymentId}`);
}

async function getNowPaymentsMinAmount(currency: string): Promise<number> {
  try {
    const payCurrency = NOWPAYMENTS_CURRENCY_MAP[currency];
    const data = await nowpaymentsRequest(
      `/min-amount?currency_from=${payCurrency}&currency_to=usd&fiat_equivalent=usd`
    ) as { min_amount?: number; fiat_equivalent?: number };
    // fiat_equivalent is the USD value of the minimum crypto amount
    const minUsd = data.fiat_equivalent ?? data.min_amount ?? 0;
    // Add a small buffer to account for price fluctuations
    return minUsd * 1.05;
  } catch {
    // Fallback hardcoded minimums if API call fails
    const FALLBACK: Record<string, number> = { BTC: 2, LTC: 2, USDT: 20 };
    return FALLBACK[currency] ?? 2;
  }
}

function isPaymentSuccessful(status: string): boolean {
  return status === "finished" || status === "confirmed";
}

function verifyNowPaymentsIpn(body: string, signature: string): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha512", secret).update(body).digest("hex");
  return expected === signature;
}

async function activateSlot(userId: string, slotNumber: number, paymentId: string, durationHoursOverride?: number) {
  const { slotDurationHours } = await getSettings();
  const hours = durationHoursOverride ?? slotDurationHours;
  const expiryMs = hours * 60 * 60 * 1000;

  await db.update(paymentsTable)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(paymentsTable.id, paymentId));

  const userRows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const user = userRows[0];

  let luarmorUserId: string | null = null;
  if (isLuarmorConfigured() && user) {
    try {
      const luarmorUser = await createLuarmorUser(user.discordId, user.username);
      luarmorUserId = luarmorUser.id;
    } catch {
      // Luarmor failure should not block slot activation
    }
  }

  const existing = await db.select().from(slotsTable).where(
    and(eq(slotsTable.userId, userId), eq(slotsTable.slotNumber, slotNumber))
  ).limit(1);

  const slotData = {
    isActive: true,
    purchasedAt: new Date(),
    expiresAt: new Date(Date.now() + expiryMs),
    ...(luarmorUserId ? { luarmorUserId } : {}),
  };

  if (existing.length > 0) {
    await db.update(slotsTable).set(slotData)
      .where(and(eq(slotsTable.userId, userId), eq(slotsTable.slotNumber, slotNumber)));
  } else {
    await db.insert(slotsTable).values({ userId, slotNumber, ...slotData });
  }

  // Get payment for webhook details
  const paymentRows = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId)).limit(1);
  if (user && paymentRows.length) {
    const p = paymentRows[0];
    await sendPaymentWebhook({
      username: user.username,
      discordId: user.discordId,
      method: p.method,
      currency: p.currency,
      amount: p.amount,
      slotNumber,
    });
  }
}

router.post("/create-stripe-session", requireAuth, async (req: Request, res: Response) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(503).json({ error: "payment_unavailable", message: "Stripe is not configured" });
    return;
  }

  const { slotNumber, hours } = req.body;
  const { slotCount, pricePerDay, slotDurationHours, hourlyPricingEnabled, pricePerHour, minHours } = await getSettings();
  if (!slotNumber || slotNumber < 1 || slotNumber > slotCount) {
    res.status(400).json({ error: "invalid_slot", message: "Invalid slot number" });
    return;
  }

  // Validate hours when hourly pricing is enabled
  let purchasedHours: number = slotDurationHours;
  let chargeAmount: number = pricePerDay;
  let description: string = `${slotDurationHours}h activation for Exe Joiner slot at $${pricePerDay.toFixed(2)}`;

  if (hourlyPricingEnabled) {
    const h = parseInt(hours, 10);
    if (!hours || isNaN(h) || h < minHours) {
      res.status(400).json({ error: "invalid_hours", message: `Minimum purchase is ${minHours} hour(s)` });
      return;
    }
    purchasedHours = h;
    chargeAmount = parseFloat((h * pricePerHour).toFixed(2));
    description = `${h}h activation for Exe Joiner slot at $${pricePerHour.toFixed(2)}/hr`;
  }

  const slots = await db.select().from(slotsTable).where(
    and(eq(slotsTable.userId, req.session.userId!), eq(slotsTable.slotNumber, slotNumber))
  ).limit(1);

  if (slots.length > 0 && slots[0].isActive) {
    res.status(400).json({ error: "slot_active", message: "Slot is already active" });
    return;
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey);

    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.BASE_URL || "http://localhost:80";
    const unitAmount = Math.round(chargeAmount * 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            product_data: {
              name: `Exe Joiner — Slot #${slotNumber}`,
              description,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: req.session.userId!,
        slotNumber: String(slotNumber),
      },
      success_url: `${baseUrl}/dashboard?payment=success&slot=${slotNumber}`,
      cancel_url: `${baseUrl}/dashboard?payment=cancelled`,
    });

    const paymentId = crypto.randomUUID();
    await db.insert(paymentsTable).values({
      id: paymentId,
      userId: req.session.userId!,
      slotNumber,
      method: "stripe",
      status: "pending",
      amount: chargeAmount.toFixed(2),
      currency: "USD",
      stripeSessionId: session.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      derivationIndex: purchasedHours,
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    req.log.error({ err }, "Stripe session creation failed");
    res.status(500).json({ error: "server_error", message: "Failed to create payment session" });
  }
});

router.post("/stripe-webhook", async (req: Request, res: Response) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    res.status(503).json({ error: "payment_unavailable", message: "Stripe not configured" });
    return;
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeKey);

    const sig = req.headers["stripe-signature"] as string;
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
    } catch (err) {
      req.log.warn({ err }, "Stripe webhook signature verification failed");
      res.status(400).json({ error: "invalid_signature" });
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as { metadata?: { userId?: string; slotNumber?: string; isPreorder?: string; type?: string }; payment_status?: string };
      const { userId, slotNumber, isPreorder, type } = session.metadata || {};

      if (userId && session.payment_status === "paid") {
        if (type === "balance_deposit") {
          // Balance deposit — credit the user's balance
          const pending = await db.select().from(paymentsTable)
            .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.method, "balance-deposit-stripe"), eq(paymentsTable.status, "pending")))
            .orderBy(paymentsTable.createdAt)
            .limit(1);
          if (pending.length) {
            const depositAmount = parseFloat(pending[0].amount ?? "0");
            await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, pending[0].id));
            await db.update(usersTable)
              .set({ balance: sql`${usersTable.balance} + ${depositAmount.toFixed(2)}::numeric`, updatedAt: new Date() })
              .where(eq(usersTable.id, userId));
          }
        } else if (isPreorder === "true") {
          // Pre-order payment — mark payment completed + create preorder record
          const pending = await db.select().from(paymentsTable)
            .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.slotNumber, 0), eq(paymentsTable.status, "pending"), eq(paymentsTable.method, "preorder-stripe")))
            .limit(1);
          if (pending.length) {
            await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, pending[0].id));
            await db.insert(preordersTable).values({
              userId,
              amount: pending[0].amount ?? "0",
              currency: "USD",
              paymentId: pending[0].id,
              status: "paid",
            });
          }
        } else if (slotNumber) {
          const slotNum = parseInt(slotNumber, 10);
          const pending = await db.select().from(paymentsTable)
            .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.slotNumber, slotNum), eq(paymentsTable.status, "pending")))
            .limit(1);
          if (pending.length) {
            await activateSlot(userId, slotNum, pending[0].id, pending[0].derivationIndex ?? undefined);
          }
        }
      }
    }

    res.json({ success: true, message: "Webhook processed" });
  } catch (err) {
    req.log.error({ err }, "Stripe webhook error");
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/create-crypto-session", requireAuth, async (req: Request, res: Response) => {
  const { slotNumber, currency, hours } = req.body;
  const { slotCount, pricePerDay, slotDurationHours, hourlyPricingEnabled, pricePerHour, minHours } = await getSettings();

  if (!slotNumber || slotNumber < 1 || slotNumber > slotCount) {
    res.status(400).json({ error: "invalid_slot", message: "Invalid slot number" });
    return;
  }

  if (!currency || !VALID_CURRENCIES.includes(currency)) {
    res.status(400).json({ error: "invalid_currency", message: "Invalid currency. Supported: BTC, LTC, USDT (TRC20)" });
    return;
  }

  if (!process.env.NOWPAYMENTS_API_KEY) {
    res.status(503).json({ error: "payment_unavailable", message: "Crypto payments not configured" });
    return;
  }

  let purchasedHours: number = slotDurationHours;
  let chargeAmount: number = pricePerDay;

  if (hourlyPricingEnabled) {
    const h = parseInt(hours, 10);
    if (!hours || isNaN(h) || h < minHours) {
      res.status(400).json({ error: "invalid_hours", message: `Minimum purchase is ${minHours} hour(s)` });
      return;
    }
    purchasedHours = h;
    chargeAmount = parseFloat((h * pricePerHour).toFixed(2));
  }

  const slots = await db.select().from(slotsTable).where(
    and(eq(slotsTable.userId, req.session.userId!), eq(slotsTable.slotNumber, slotNumber))
  ).limit(1);

  if (slots.length > 0 && slots[0].isActive) {
    res.status(400).json({ error: "slot_active", message: "Slot is already active" });
    return;
  }

  try {
    const paymentId = crypto.randomUUID();

    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.BASE_URL || "http://localhost:80";
    const ipnCallbackUrl = `${baseUrl}/api/payments/nowpayments-ipn`;

    const minUsd = await getNowPaymentsMinAmount(currency);
    if (minUsd > 0 && chargeAmount < minUsd) {
      res.status(400).json({
        error: "below_minimum",
        message: `${currency === 'USDT' ? 'USDT TRC20' : currency} requires a minimum payment of $${minUsd.toFixed(2)} USD. Your current price ($${chargeAmount.toFixed(2)}) is too low for this currency.`,
      });
      return;
    }

    const nowPayment = await createNowPaymentsPayment(paymentId, chargeAmount, currency, ipnCallbackUrl);

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const amount = String(nowPayment.pay_amount);

    await db.insert(paymentsTable).values({
      id: paymentId,
      userId: req.session.userId!,
      slotNumber,
      method: "crypto",
      status: "pending",
      currency,
      amount,
      address: nowPayment.pay_address,
      txHash: nowPayment.payment_id,
      expiresAt,
      derivationIndex: purchasedHours,
    });

    res.json({
      paymentId,
      address: nowPayment.pay_address,
      amount,
      currency,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Crypto session creation failed");
    res.status(500).json({ error: "server_error", message: "Failed to create crypto payment" });
  }
});

router.post("/nowpayments-ipn", async (req: Request, res: Response) => {
  const signature = req.headers["x-nowpayments-sig"] as string;
  const rawBody = JSON.stringify(req.body);

  if (!verifyNowPaymentsIpn(rawBody, signature)) {
    req.log.warn("NOWPayments IPN signature verification failed");
    res.status(400).json({ error: "invalid_signature" });
    return;
  }

  try {
    const { order_id, payment_status } = req.body as { order_id: string; payment_status: string };

    if (!isPaymentSuccessful(payment_status)) {
      res.json({ received: true });
      return;
    }

    const payments = await db.select().from(paymentsTable)
      .where(and(eq(paymentsTable.id, order_id), eq(paymentsTable.status, "pending")))
      .limit(1);

    if (!payments.length) {
      res.json({ received: true });
      return;
    }

    const payment = payments[0];

    if (payment.method === "balance-deposit-crypto") {
      // Balance deposit — credit user balance
      const depositAmount = parseFloat(payment.amount ?? "0");
      await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, payment.id));
      await db.update(usersTable)
        .set({ balance: sql`${usersTable.balance} + ${depositAmount.toFixed(2)}::numeric`, updatedAt: new Date() })
        .where(eq(usersTable.id, payment.userId));
      req.log.info({ paymentId: payment.id, amount: depositAmount }, "NOWPayments IPN: balance credited");
    } else if (payment.method === "preorder-crypto") {
      // Pre-order: mark payment completed + create preorder record
      await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, payment.id));
      await db.insert(preordersTable).values({
        userId: payment.userId,
        amount: payment.amount ?? "0",
        currency: payment.currency,
        paymentId: payment.id,
        status: "paid",
      });
      req.log.info({ paymentId: payment.id }, "NOWPayments IPN: pre-order activated");
    } else {
      await activateSlot(payment.userId, payment.slotNumber, payment.id, payment.derivationIndex ?? undefined);
      req.log.info({ paymentId: payment.id }, "NOWPayments IPN: slot activated");
    }

    res.json({ received: true });
  } catch (err) {
    req.log.error({ err }, "NOWPayments IPN processing failed");
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/cancel-pending", requireAuth, async (req: Request, res: Response) => {
  try {
    await db.delete(paymentsTable).where(
      and(
        eq(paymentsTable.userId, req.session.userId!),
        eq(paymentsTable.status, "pending"),
        ne(paymentsTable.method, "preorder-stripe"),
        ne(paymentsTable.method, "preorder-crypto"),
        ne(paymentsTable.method, "balance-deposit-stripe"),
        ne(paymentsTable.method, "balance-deposit-crypto"),
      )
    );
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to cancel pending payments");
    res.status(500).json({ error: "server_error", message: "Failed to cancel pending payments" });
  }
});

router.post("/verify-crypto", requireAuth, async (req: Request, res: Response) => {
  const { paymentId } = req.body;

  if (!paymentId) {
    res.status(400).json({ error: "invalid_request", message: "Payment ID required" });
    return;
  }

  try {
    const payments = await db.select().from(paymentsTable).where(
      and(eq(paymentsTable.id, paymentId), eq(paymentsTable.userId, req.session.userId!))
    ).limit(1);

    if (!payments.length) {
      res.status(404).json({ error: "not_found", message: "Payment not found" });
      return;
    }

    const payment = payments[0];

    if (payment.status === "completed") {
      res.json({ success: true, message: "Payment already verified" });
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

    const nowStatus = await getNowPaymentsStatus(payment.txHash);

    if (!isPaymentSuccessful(nowStatus.payment_status)) {
      res.status(402).json({
        error: "not_confirmed",
        message: `Payment status: ${nowStatus.payment_status}. Please wait and try again.`,
      });
      return;
    }

    await activateSlot(payment.userId, payment.slotNumber, payment.id, payment.derivationIndex ?? undefined);
    res.json({ success: true, message: "Payment verified and slot activated" });
  } catch (err) {
    req.log.error({ err }, "Crypto payment verification failed");
    res.status(500).json({ error: "server_error", message: "Verification failed" });
  }
});

export default router;
