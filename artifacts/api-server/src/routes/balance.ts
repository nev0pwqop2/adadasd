import { Router, Request, Response } from "express";
import { db, paymentsTable, usersTable, couponsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
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
  ETH: "eth",
  SOL: "sol",
};

const VALID_CURRENCIES = ["BTC", "LTC", "USDT", "ETH", "SOL"];

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
      usdAmount: amount.toFixed(2),
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
      : process.env.BASE_URL?.startsWith("https://")
        ? process.env.BASE_URL
        : null;
    const ipnCallbackUrl = baseUrl ? `${baseUrl}/api/payments/nowpayments-ipn` : undefined;
    const nowCurrency = NOWPAYMENTS_CURRENCY_MAP[currency];

    let minAmount = 2;
    try {
      const minData = await nowpaymentsRequest(`/min-amount?currency_from=${nowCurrency}&currency_to=usd&fiat_equivalent=usd`) as { min_amount?: number; fiat_equivalent?: number };
      const minUsd = minData.fiat_equivalent ?? minData.min_amount ?? 0;
      if (minUsd > 0) minAmount = minUsd * 1.05;
    } catch {}

    if (amount < minAmount) {
      res.status(400).json({ error: "below_minimum", minAmount });
      return;
    }

    const nowBody: Record<string, unknown> = {
      price_amount: amount,
      price_currency: "usd",
      pay_currency: nowCurrency,
      order_id: paymentId,
    };
    if (ipnCallbackUrl) nowBody.ipn_callback_url = ipnCallbackUrl;

    const nowPayment = await nowpaymentsRequest("/payment", {
      method: "POST",
      body: JSON.stringify(nowBody),
    }) as { pay_address: string; pay_amount: number; pay_currency: string };

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.insert(paymentsTable).values({
      id: paymentId,
      userId: req.session.userId!,
      slotNumber: 0,
      method: "balance-deposit-crypto",
      status: "pending",
      currency,
      amount: amount.toFixed(2),
      usdAmount: amount.toFixed(2),
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
    const detail = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Balance crypto deposit failed");
    res.status(500).json({ error: "server_error", message: `Failed to create crypto payment: ${detail}` });
  }
});

// POST /api/balance/deposit/verify — manually verify a crypto deposit payment
router.post("/deposit/verify", requireAuth, async (req: Request, res: Response) => {
  const { paymentId } = req.body as { paymentId?: string };
  if (!paymentId) {
    res.status(400).json({ error: "invalid_request", message: "Payment ID required" });
    return;
  }

  try {
    const payments = await db.select().from(paymentsTable).where(
      and(
        eq(paymentsTable.id, paymentId),
        eq(paymentsTable.userId, req.session.userId!),
        eq(paymentsTable.method, "balance-deposit-crypto"),
      )
    ).limit(1);

    if (!payments.length) {
      res.status(404).json({ error: "not_found", message: "Payment not found" });
      return;
    }

    const payment = payments[0];

    if (payment.status === "completed") {
      res.json({ success: true, alreadyCredited: true, message: "Balance already credited" });
      return;
    }

    if (!payment.txHash) {
      res.status(400).json({ error: "invalid_payment", message: "No payment reference found" });
      return;
    }

    const nowStatus = await nowpaymentsRequest(`/payment/${payment.txHash}`) as { payment_status: string };
    const isConfirmed = nowStatus.payment_status === "finished" || nowStatus.payment_status === "confirmed";

    if (!isConfirmed) {
      res.status(402).json({
        error: "not_confirmed",
        message: `Payment status: ${nowStatus.payment_status}. Please wait and try again.`,
      });
      return;
    }

    const depositAmount = parseFloat(payment.amount ?? "0");
    await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, payment.id));
    await db.update(usersTable)
      .set({ balance: sql`${usersTable.balance} + ${depositAmount.toFixed(2)}::numeric`, updatedAt: new Date() })
      .where(eq(usersTable.id, req.session.userId!));

    const userRows = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId!)).limit(1);
    if (userRows.length) {
      await sendPaymentWebhook({
        username: userRows[0].username,
        discordId: userRows[0].discordId,
        method: payment.method,
        currency: payment.currency,
        amount: payment.amount,
        purchaseType: "balance_deposit",
      });
    }

    res.json({ success: true, alreadyCredited: false, message: "Balance credited successfully" });
  } catch (err) {
    req.log.error({ err }, "Balance deposit verification failed");
    res.status(500).json({ error: "server_error", message: "Verification failed" });
  }
});

// DELETE /api/balance/deposit/cancel — cancel any pending deposit payments
router.delete("/deposit/cancel", requireAuth, async (req: Request, res: Response) => {
  try {
    await db.delete(paymentsTable).where(
      and(
        eq(paymentsTable.userId, req.session.userId!),
        eq(paymentsTable.status, "pending"),
        eq(paymentsTable.method, "balance-deposit-crypto"),
      )
    );
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to cancel pending deposit");
    res.status(500).json({ error: "server_error" });
  }
});

// POST /api/balance/use — buy a slot using account balance
router.post("/use", requireAuth, async (req: Request, res: Response) => {
  const rawSlot = Number(req.body?.slotNumber);
  const rawHours = req.body?.hours !== undefined ? Number(req.body.hours) : undefined;
  const couponId = req.body?.couponId ? Number(req.body.couponId) : undefined;

  const slotNumber = Number.isInteger(rawSlot) ? rawSlot : NaN;

  if (!Number.isFinite(slotNumber) || slotNumber < 1) {
    res.status(400).json({ error: "invalid_slot", message: "Invalid slot number." });
    return;
  }

  try {
    const settings = await getSettings();
    const { pricePerDay, pricePerHour, hourlyPricingEnabled, minHours, slotDurationHours, slotCount } = settings;

    // Reject slot numbers above the configured max
    if (slotNumber > slotCount) {
      res.status(400).json({ error: "invalid_slot", message: `Slot number must be between 1 and ${slotCount}.` });
      return;
    }

    let chargeAmount: number;
    let purchasedHours: number;

    if (hourlyPricingEnabled) {
      const h = rawHours !== undefined ? Math.floor(rawHours) : minHours;
      if (!Number.isFinite(h) || h < minHours || h > 8760) {
        res.status(400).json({ error: "invalid_hours", message: `Hours must be between ${minHours} and 8760.` });
        return;
      }
      chargeAmount = h * pricePerHour;
      purchasedHours = h;
    } else {
      chargeAmount = pricePerDay;
      purchasedHours = slotDurationHours;
    }

    const userId = req.session.userId!;

    const userRows = await db
      .select({ balance: usersTable.balance, discordId: usersTable.discordId, username: usersTable.username, isBanned: usersTable.isBanned })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (userRows[0]?.isBanned) {
      res.status(403).json({ error: "banned", message: "Your account has been banned." });
      return;
    }

    // Apply coupon discount if provided
    let couponApplied = false;
    if (couponId) {
      // Per-user check: has this user already used this coupon?
      const priorUse = await db
        .select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(
          eq(paymentsTable.userId, userId),
          eq(paymentsTable.couponId, couponId),
          eq(paymentsTable.status, "completed")
        ))
        .limit(1);

      if (priorUse.length) {
        res.status(400).json({ error: "coupon_already_used", message: "You have already used this coupon." });
        return;
      }

      // Fetch coupon details to calculate discount (read-only — actual consumption is atomic below)
      const couponRows = await db
        .select()
        .from(couponsTable)
        .where(and(eq(couponsTable.id, couponId), eq(couponsTable.isActive, true)))
        .limit(1);

      if (couponRows.length) {
        const coupon = couponRows[0];
        const now = new Date();
        const notExpired = !coupon.expiresAt || coupon.expiresAt > now;
        const notExhausted = coupon.maxUses === null || coupon.usedCount < coupon.maxUses;

        if (notExpired && notExhausted) {
          const discountValue = parseFloat(coupon.discountValue);
          if (coupon.discountType === "percent") {
            chargeAmount = parseFloat(Math.max(0, chargeAmount - chargeAmount * (discountValue / 100)).toFixed(2));
          } else {
            chargeAmount = parseFloat(Math.max(0, chargeAmount - discountValue).toFixed(2));
          }
          couponApplied = true;
        }
      }
    }

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

    // Atomically deduct balance — the WHERE clause also checks balance >= chargeAmount,
    // preventing race conditions where concurrent requests overdraw the account.
    const deducted = await db.update(usersTable)
      .set({ balance: sql`${usersTable.balance} - ${chargeAmount.toFixed(2)}::numeric`, updatedAt: new Date() })
      .where(and(eq(usersTable.id, userId), sql`${usersTable.balance} >= ${chargeAmount.toFixed(2)}::numeric`))
      .returning({ balance: usersTable.balance });

    if (!deducted.length) {
      res.status(400).json({ error: "insufficient_balance", message: "Insufficient balance." });
      return;
    }

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
      ...(couponId && couponApplied ? { couponId } : {}),
    });

    // Activate slot
    const durationMs = hourlyPricingEnabled
      ? purchasedHours * 60 * 60 * 1000
      : slotDurationHours * 60 * 60 * 1000;

    const expiresAt = new Date(Date.now() + durationMs);

    let luarmorUserId: string | null = null;
    if (isLuarmorConfigured() && userRows[0]) {
      try {
        const luarmorUser = await createLuarmorUser(
          userRows[0].discordId,
          userRows[0].username,
          expiresAt
        );
        luarmorUserId = luarmorUser.user_key;
      } catch (e) {
        req.log.warn({ e }, "Luarmor user creation failed (balance payment)");
      }
    }

    const slotData = {
      userId,
      isActive: true,
      purchasedAt: new Date(),
      expiresAt,
      ...(luarmorUserId ? { luarmorUserId } : {}),
    };

    if (slotRows.length) {
      await db.update(slotsTable).set(slotData).where(
        and(eq(slotsTable.userId, userId), eq(slotsTable.slotNumber, slotNumber))
      );
    } else {
      await db.insert(slotsTable).values({ slotNumber, ...slotData });
    }

    // Discord webhook
    try {
      const webhookUserRows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (webhookUserRows.length) {
        await sendPaymentWebhook({
          username: webhookUserRows[0].username,
          discordId: webhookUserRows[0].discordId,
          method: "balance",
          currency: "USD",
          amount: chargeAmount.toFixed(2),
          slotNumber,
          purchaseType: "slot",
          durationHours: purchasedHours,
          expiresAt,
        });
      }
    } catch (webhookErr) {
      req.log.warn({ webhookErr }, "Balance purchase webhook failed");
    }

    // Atomically consume one coupon use — WHERE ensures maxUses can never be exceeded
    // even under concurrent requests (the DB serialises this UPDATE at row level).
    if (couponId && couponApplied) {
      await db.update(couponsTable)
        .set({ usedCount: sql`${couponsTable.usedCount} + 1` })
        .where(and(
          eq(couponsTable.id, couponId),
          sql`(${couponsTable.maxUses} IS NULL OR ${couponsTable.usedCount} < ${couponsTable.maxUses})`
        ))
        .catch(() => {});
    }

    res.json({ success: true, slotNumber, expiresAt: expiresAt.toISOString(), balance: (currentBalance - chargeAmount).toFixed(2) });
  } catch (err) {
    req.log.error({ err }, "Buy with balance failed");
    res.status(500).json({ error: "server_error", message: "Failed to purchase slot" });
  }
});

export default router;
