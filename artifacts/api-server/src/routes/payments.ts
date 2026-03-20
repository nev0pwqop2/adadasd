import { Router, Request, Response } from "express";
import { db, slotsTable, paymentsTable } from "@workspace/db";
import { eq, and, max } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getSettings } from "../lib/settings.js";
import { deriveAddress, getXpubForCurrency } from "../lib/crypto-wallet.js";
import crypto from "crypto";

const router = Router();

const VALID_CURRENCIES = ["BTC", "LTC", "USDT"];

async function getNextDerivationIndex(currency: string): Promise<number> {
  const result = await db
    .select({ maxIndex: max(paymentsTable.derivationIndex) })
    .from(paymentsTable)
    .where(eq(paymentsTable.currency, currency));
  const current = result[0]?.maxIndex ?? -1;
  return (current ?? -1) + 1;
}

function getCryptoAmounts(usdPrice: number): Record<string, string> {
  return {
    BTC: (usdPrice / 96000).toFixed(6),
    LTC: (usdPrice / 90).toFixed(4),
    USDT: usdPrice.toFixed(2),
  };
}

async function verifyBTCPayment(address: string, requiredBTC: number, createdAt: Date): Promise<boolean> {
  try {
    const res = await fetch(`https://blockstream.info/api/address/${address}/txs`);
    if (!res.ok) return false;
    const txs = await res.json() as Array<{
      status: { confirmed: boolean; block_time?: number };
      vout: Array<{ scriptpubkey_address?: string; value: number }>;
    }>;

    const createdAtSec = Math.floor(createdAt.getTime() / 1000);
    const requiredSatoshis = Math.round(requiredBTC * 1e8);

    for (const tx of txs) {
      if (!tx.status.confirmed || !tx.status.block_time) continue;
      if (tx.status.block_time < createdAtSec) continue;

      const received = tx.vout
        .filter(o => o.scriptpubkey_address === address)
        .reduce((sum, o) => sum + o.value, 0);

      if (received >= requiredSatoshis) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function verifyLTCPayment(address: string, requiredLTC: number, createdAt: Date): Promise<boolean> {
  try {
    const res = await fetch(`https://api.blockcypher.com/v1/ltc/main/addrs/${address}/full?limit=20`);
    if (!res.ok) return false;
    const data = await res.json() as {
      txs?: Array<{
        confirmed?: string;
        outputs: Array<{ addresses?: string[]; value: number }>;
      }>;
    };

    const requiredLitoshi = Math.round(requiredLTC * 1e8);

    for (const tx of data.txs || []) {
      if (!tx.confirmed) continue;
      const txTime = new Date(tx.confirmed).getTime();
      if (txTime < createdAt.getTime()) continue;

      const received = tx.outputs
        .filter(o => o.addresses?.includes(address))
        .reduce((sum, o) => sum + o.value, 0);

      if (received >= requiredLitoshi) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function verifyUSDTTRC20Payment(address: string, requiredUSDT: number, createdAt: Date): Promise<boolean> {
  try {
    const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const res = await fetch(
      `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?contract_address=${USDT_CONTRACT}&limit=20`
    );
    if (!res.ok) return false;
    const data = await res.json() as {
      data?: Array<{
        to: string;
        value: string;
        block_timestamp: number;
      }>;
    };

    const createdAtMs = createdAt.getTime();
    const requiredMicroUSDT = Math.round(requiredUSDT * 1e6);

    for (const tx of data.data || []) {
      if (tx.to !== address) continue;
      if (tx.block_timestamp < createdAtMs) continue;
      if (parseInt(tx.value) >= requiredMicroUSDT) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function verifyOnChain(currency: string, address: string, amount: string, createdAt: Date): Promise<boolean> {
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) return false;

  if (currency === "BTC") return verifyBTCPayment(address, parsed, createdAt);
  if (currency === "LTC") return verifyLTCPayment(address, parsed, createdAt);
  if (currency === "USDT") return verifyUSDTTRC20Payment(address, parsed, createdAt);
  return false;
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

  const xpub = getXpubForCurrency(currency);
  if (!xpub) {
    res.status(503).json({ error: "payment_unavailable", message: `${currency} wallet not configured` });
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
    const derivationIndex = await getNextDerivationIndex(currency);
    const address = deriveAddress(currency, xpub, derivationIndex);

    const paymentId = crypto.randomUUID();
    const cryptoAmounts = getCryptoAmounts(pricePerDay);
    const amount = cryptoAmounts[currency];
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.insert(paymentsTable).values({
      id: paymentId,
      userId: req.session.userId!,
      slotNumber,
      method: "crypto",
      status: "pending",
      currency,
      amount,
      address,
      derivationIndex,
      expiresAt,
    });

    res.json({ paymentId, address, amount, currency, expiresAt: expiresAt.toISOString() });
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
      res.status(400).json({ error: "expired", message: "Payment session has expired" });
      return;
    }

    if (!payment.currency || !payment.address || !payment.amount) {
      res.status(400).json({ error: "invalid_payment", message: "Incomplete payment data" });
      return;
    }

    const confirmed = await verifyOnChain(payment.currency, payment.address, payment.amount, payment.createdAt);

    if (!confirmed) {
      res.status(402).json({
        error: "not_confirmed",
        message: "Payment not detected on the blockchain yet. Please wait a few minutes and try again.",
      });
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
