import { Router, Request, Response } from "express";
import { db, slotsTable, paymentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getSettings } from "../lib/settings.js";
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

function isPaymentSuccessful(status: string): boolean {
  return status === "finished" || status === "confirmed";
}

function verifyNowPaymentsIpn(body: string, signature: string): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha512", secret).update(body).digest("hex");
  return expected === signature;
}

async function activateSlot(userId: string, slotNumber: number, paymentId: string) {
  await db.update(paymentsTable)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(paymentsTable.id, paymentId));

  const existing = await db.select().from(slotsTable).where(
    and(eq(slotsTable.userId, userId), eq(slotsTable.slotNumber, slotNumber))
  ).limit(1);

  if (existing.length > 0) {
    await db.update(slotsTable)
      .set({ isActive: true, purchasedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) })
      .where(and(eq(slotsTable.userId, userId), eq(slotsTable.slotNumber, slotNumber)));
  } else {
    await db.insert(slotsTable).values({
      userId,
      slotNumber,
      isActive: true,
      purchasedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  }
}

router.post("/create-stripe-session", requireAuth, async (req: Request, res: Response) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(503).json({ error: "payment_unavailable", message: "Stripe is not configured" });
    return;
  }

  const { slotNumber } = req.body;
  const { slotCount, pricePerDay } = await getSettings();
  if (!slotNumber || slotNumber < 1 || slotNumber > slotCount) {
    res.status(400).json({ error: "invalid_slot", message: "Invalid slot number" });
    return;
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
    const unitAmount = Math.round(pricePerDay * 100);

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
              description: `1-day activation for Exe Joiner slot at $${pricePerDay.toFixed(2)}/day`,
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
      stripeSessionId: session.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
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
      const session = event.data.object as { metadata?: { userId?: string; slotNumber?: string }; payment_status?: string };
      const { userId, slotNumber } = session.metadata || {};

      if (userId && slotNumber && session.payment_status === "paid") {
        const slotNum = parseInt(slotNumber, 10);

        await db.update(paymentsTable)
          .set({ status: "completed", updatedAt: new Date() })
          .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.slotNumber, slotNum), eq(paymentsTable.status, "pending")));

        await db.update(slotsTable)
          .set({
            isActive: true,
            purchasedAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          })
          .where(and(eq(slotsTable.userId, userId), eq(slotsTable.slotNumber, slotNum)));
      }
    }

    res.json({ success: true, message: "Webhook processed" });
  } catch (err) {
    req.log.error({ err }, "Stripe webhook error");
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/create-crypto-session", requireAuth, async (req: Request, res: Response) => {
  const { slotNumber, currency } = req.body;
  const { slotCount, pricePerDay } = await getSettings();

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

    const nowPayment = await createNowPaymentsPayment(paymentId, pricePerDay, currency, ipnCallbackUrl);

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
    await activateSlot(payment.userId, payment.slotNumber, payment.id);
    req.log.info({ paymentId: payment.id }, "NOWPayments IPN: slot activated");
    res.json({ received: true });
  } catch (err) {
    req.log.error({ err }, "NOWPayments IPN processing failed");
    res.status(500).json({ error: "server_error" });
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

    await activateSlot(payment.userId, payment.slotNumber, payment.id);
    res.json({ success: true, message: "Payment verified and slot activated" });
  } catch (err) {
    req.log.error({ err }, "Crypto payment verification failed");
    res.status(500).json({ error: "server_error", message: "Verification failed" });
  }
});

export default router;
