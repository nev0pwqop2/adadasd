import { Router, Request, Response } from "express";
import { db, slotsTable, paymentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import crypto from "crypto";

const router = Router();

const SLOT_PRICE_USD = "4.99";

const CRYPTO_ADDRESSES: Record<string, string> = {
  BTC: process.env.CRYPTO_BTC_ADDRESS || "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  ETH: process.env.CRYPTO_ETH_ADDRESS || "0x742d35Cc6634C0532925a3b8D4C9C3C3Cd153De",
  LTC: process.env.CRYPTO_LTC_ADDRESS || "LQfTFgCxmGPxGoGQGh8mZm7BmjBJMcbhAQ",
  USDT: process.env.CRYPTO_USDT_ADDRESS || "0x742d35Cc6634C0532925a3b8D4C9C3C3Cd153De",
  USDC: process.env.CRYPTO_USDC_ADDRESS || "0x742d35Cc6634C0532925a3b8D4C9C3C3Cd153De",
  SOL: process.env.CRYPTO_SOL_ADDRESS || "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKH",
};

const CRYPTO_AMOUNTS: Record<string, string> = {
  BTC: "0.000075",
  ETH: "0.0021",
  LTC: "0.075",
  USDT: "4.99",
  USDC: "4.99",
  SOL: "0.032",
};

router.post("/create-stripe-session", requireAuth, async (req: Request, res: Response) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(503).json({ error: "payment_unavailable", message: "Stripe is not configured" });
    return;
  }

  const { slotNumber } = req.body;
  if (!slotNumber || slotNumber < 1 || slotNumber > 6) {
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

    const baseUrl = process.env.BASE_URL || "http://localhost:80";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: 499,
            product_data: {
              name: `Exe Joiner — Slot #${slotNumber}`,
              description: "1 month activation for Exe Joiner slot",
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

  if (!slotNumber || slotNumber < 1 || slotNumber > 6) {
    res.status(400).json({ error: "invalid_slot", message: "Invalid slot number" });
    return;
  }

  const validCurrencies = ["BTC", "ETH", "LTC", "USDT", "USDC", "SOL"];
  if (!currency || !validCurrencies.includes(currency)) {
    res.status(400).json({ error: "invalid_currency", message: "Invalid currency" });
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
    const address = CRYPTO_ADDRESSES[currency];
    const amount = CRYPTO_AMOUNTS[currency];
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await db.insert(paymentsTable).values({
      id: paymentId,
      userId: req.session.userId!,
      slotNumber,
      method: "crypto",
      status: "pending",
      currency,
      amount,
      address,
      expiresAt,
    });

    res.json({
      paymentId,
      address,
      amount,
      currency,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Crypto session creation failed");
    res.status(500).json({ error: "server_error", message: "Failed to create crypto payment" });
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
      res.status(400).json({ error: "expired", message: "Payment has expired" });
      return;
    }

    await db.update(paymentsTable)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(paymentsTable.id, paymentId));

    await db.update(slotsTable)
      .set({
        isActive: true,
        purchasedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .where(and(eq(slotsTable.userId, req.session.userId!), eq(slotsTable.slotNumber, payment.slotNumber)));

    res.json({ success: true, message: "Payment verified and slot activated" });
  } catch (err) {
    req.log.error({ err }, "Crypto payment verification failed");
    res.status(500).json({ error: "server_error", message: "Verification failed" });
  }
});

export default router;
