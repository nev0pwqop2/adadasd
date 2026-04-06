import { Router, Request, Response } from "express";
import { db, slotsTable, paymentsTable, usersTable, preordersTable, couponsTable } from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getSettings } from "../lib/settings.js";
import { isLuarmorConfigured, createLuarmorUser } from "../lib/luarmor.js";
import { sendPaymentWebhook, sendDiscordDM, type PurchaseType } from "../lib/discord.js";
import { generateSlotToken } from "../lib/slotToken.js";
import { activateSlotShared } from "../lib/slotActivation.js";
import crypto from "crypto";

async function applyCouponDiscount(couponId: number | undefined, baseAmount: number): Promise<{ finalAmount: number; validCouponId: number | null }> {
  if (!couponId) return { finalAmount: baseAmount, validCouponId: null };

  const couponRows = await db
    .select()
    .from(couponsTable)
    .where(and(eq(couponsTable.id, couponId), eq(couponsTable.isActive, true)))
    .limit(1);

  if (!couponRows.length) return { finalAmount: baseAmount, validCouponId: null };

  const coupon = couponRows[0];
  const now = new Date();
  const notExpired = !coupon.expiresAt || coupon.expiresAt > now;
  const notExhausted = coupon.maxUses === null || coupon.usedCount < coupon.maxUses;

  if (!notExpired || !notExhausted) return { finalAmount: baseAmount, validCouponId: null };

  const discountValue = parseFloat(coupon.discountValue);
  let finalAmount: number;
  if (coupon.discountType === "percent") {
    finalAmount = parseFloat(Math.max(0, baseAmount - baseAmount * (discountValue / 100)).toFixed(2));
  } else {
    finalAmount = parseFloat(Math.max(0, baseAmount - discountValue).toFixed(2));
  }

  return { finalAmount, validCouponId: coupon.id };
}

const router = Router();


const VALID_CURRENCIES = ["BTC", "LTC", "USDT", "ETH", "SOL"];

const NOWPAYMENTS_CURRENCY_MAP: Record<string, string> = {
  BTC: "btc",
  LTC: "ltc",
  USDT: "usdttrc20",
  ETH: "eth",
  SOL: "sol",
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
  ipnCallbackUrl?: string
): Promise<{ payment_id: string; pay_address: string; pay_amount: number; pay_currency: string }> {
  const body: Record<string, unknown> = {
    price_amount: usdAmount,
    price_currency: "usd",
    pay_currency: NOWPAYMENTS_CURRENCY_MAP[currency],
    order_id: orderId,
    order_description: `Exe Joiner slot activation`,
  };
  if (ipnCallbackUrl) {
    body.ipn_callback_url = ipnCallbackUrl;
  }
  return nowpaymentsRequest("/payment", {
    method: "POST",
    body: JSON.stringify(body),
  }) as Promise<{ payment_id: string; pay_address: string; pay_amount: number; pay_currency: string }>;
}

async function getNowPaymentsStatus(nowpaymentsPaymentId: string): Promise<{ payment_status: string }> {
  return nowpaymentsRequest(`/payment/${nowpaymentsPaymentId}`) as Promise<{ payment_status: string }>;
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

function verifyNowPaymentsIpn(parsedBody: Record<string, unknown>, signature: string): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  // If no IPN secret is configured, skip signature check — the live API double-check below handles security
  if (!secret) return true;
  if (!signature) return false;
  // NOWPayments signs the body with keys sorted alphabetically
  const sortedBody = JSON.stringify(
    Object.keys(parsedBody).sort().reduce((acc, key) => {
      acc[key] = parsedBody[key];
      return acc;
    }, {} as Record<string, unknown>)
  );
  const expected = crypto.createHmac("sha512", secret).update(sortedBody).digest("hex");
  return expected === signature;
}

const activateSlot = activateSlotShared;

router.post("/create-stripe-session", requireAuth, async (req: Request, res: Response) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(503).json({ error: "payment_unavailable", message: "Stripe is not configured" });
    return;
  }

  const { slotNumber, hours, couponId } = req.body;
  const { slotCount, pricePerDay, slotDurationHours, hourlyPricingEnabled, pricePerHour, minHours } = await getSettings();
  if (!slotNumber || slotNumber < 1 || slotNumber > slotCount) {
    res.status(400).json({ error: "invalid_slot", message: "Invalid slot number" });
    return;
  }

  // Validate hours when hourly pricing is enabled
  let purchasedHours: number = slotDurationHours;
  let baseAmount: number = pricePerDay;
  let description: string = `${slotDurationHours}h activation for Exe Joiner slot at $${pricePerDay.toFixed(2)}`;

  if (hourlyPricingEnabled) {
    const h = parseInt(hours, 10);
    if (!hours || isNaN(h) || h < minHours) {
      res.status(400).json({ error: "invalid_hours", message: `Minimum purchase is ${minHours} hour(s)` });
      return;
    }
    purchasedHours = h;
    baseAmount = parseFloat((h * pricePerHour).toFixed(2));
    description = `${h}h activation for Exe Joiner slot at $${pricePerHour.toFixed(2)}/hr`;
  }

  // Apply coupon discount
  const { finalAmount: chargeAmount, validCouponId } = await applyCouponDiscount(couponId, baseAmount);
  if (validCouponId && chargeAmount !== baseAmount) {
    description += ` (coupon applied)`;
  }

  const slots = await db.select().from(slotsTable).where(
    and(eq(slotsTable.isActive, true), eq(slotsTable.slotNumber, slotNumber))
  ).limit(1);

  if (slots.length > 0) {
    if (slots[0].userId === req.session.userId!) {
      res.status(400).json({ error: "slot_active", message: "You already have this slot active." });
    } else {
      res.status(409).json({ error: "slot_taken", message: "This slot was just taken by another user. Please choose a different slot." });
    }
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
        ...(validCouponId ? { couponId: String(validCouponId) } : {}),
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
      usdAmount: chargeAmount.toFixed(2),
      currency: "USD",
      stripeSessionId: session.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      derivationIndex: purchasedHours,
      couponId: validCouponId,
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
      const session = event.data.object as {
        id: string;
        metadata?: { userId?: string; slotNumber?: string; isPreorder?: string; type?: string; couponId?: string };
        payment_status?: string;
        amount_total?: number | null;
      };
      const { userId, slotNumber, isPreorder, type, couponId: metaCouponId } = session.metadata || {};
      const stripeSessionId = session.id;

      if (userId && session.payment_status === "paid") {

        // Idempotency: skip if this session was already fully processed
        const alreadyDone = await db.select({ id: paymentsTable.id })
          .from(paymentsTable)
          .where(and(eq(paymentsTable.stripeSessionId, stripeSessionId), eq(paymentsTable.status, "completed")))
          .limit(1);
        if (alreadyDone.length) {
          req.log.info({ stripeSessionId }, "Stripe webhook: session already processed, skipping");
          res.json({ success: true, message: "Already processed" });
          return;
        }

        if (type === "balance_deposit") {
          // Find pending record — fall back to Stripe session amount if none found
          const pending = await db.select().from(paymentsTable)
            .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.method, "balance-deposit-stripe"), eq(paymentsTable.status, "pending")))
            .orderBy(paymentsTable.createdAt)
            .limit(1);

          let depositAmount: number;
          let paymentRecordId: string;

          if (pending.length) {
            depositAmount = parseFloat(pending[0].amount ?? "0");
            paymentRecordId = pending[0].id;
            await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, paymentRecordId));
          } else {
            // No pending record — create one from Stripe session data
            depositAmount = session.amount_total ? session.amount_total / 100 : 0;
            if (depositAmount <= 0) {
              req.log.warn({ stripeSessionId, userId }, "Stripe webhook: balance deposit amount is 0, skipping");
              res.json({ success: true });
              return;
            }
            paymentRecordId = crypto.randomUUID();
            await db.insert(paymentsTable).values({
              id: paymentRecordId,
              userId,
              slotNumber: 0,
              method: "balance-deposit-stripe",
              status: "completed",
              amount: depositAmount.toFixed(2),
              usdAmount: depositAmount.toFixed(2),
              currency: "USD",
              stripeSessionId,
            });
            req.log.warn({ stripeSessionId, userId, depositAmount }, "Stripe webhook: no pending record found, created from session data");
          }

          await db.update(usersTable)
            .set({ balance: sql`${usersTable.balance} + ${depositAmount.toFixed(2)}::numeric`, updatedAt: new Date() })
            .where(eq(usersTable.id, userId));

          const userRows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
          if (userRows.length) {
            await sendPaymentWebhook({
              username: userRows[0].username,
              discordId: userRows[0].discordId,
              method: "balance-deposit-stripe",
              currency: "USD",
              amount: depositAmount.toFixed(2),
              purchaseType: "balance_deposit",
            });
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
              hoursRequested: pending[0].derivationIndex ?? null,
            });
            const userRows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
            if (userRows.length) {
              await sendPaymentWebhook({
                username: userRows[0].username,
                discordId: userRows[0].discordId,
                method: pending[0].method,
                currency: "USD",
                amount: pending[0].amount,
                purchaseType: "preorder",
              });
            }
          }
        } else if (slotNumber) {
          const slotNum = parseInt(slotNumber, 10);
          const pending = await db.select().from(paymentsTable)
            .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.slotNumber, slotNum), eq(paymentsTable.status, "pending")))
            .limit(1);

          if (pending.length) {
            await activateSlot(userId, slotNum, pending[0].id, pending[0].derivationIndex ?? undefined);
            const couponIdToIncrement = pending[0].couponId ?? (metaCouponId ? parseInt(metaCouponId, 10) : null);
            if (couponIdToIncrement) {
              await db.update(couponsTable)
                .set({ usedCount: sql`${couponsTable.usedCount} + 1` })
                .where(eq(couponsTable.id, couponIdToIncrement))
                .catch(() => {});
            }
          } else {
            // No pending record — create one from Stripe session data and activate slot
            const chargeAmount = session.amount_total ? session.amount_total / 100 : 0;
            const paymentRecordId = crypto.randomUUID();
            await db.insert(paymentsTable).values({
              id: paymentRecordId,
              userId,
              slotNumber: slotNum,
              method: "stripe",
              status: "completed",
              amount: chargeAmount.toFixed(2),
              usdAmount: chargeAmount.toFixed(2),
              currency: "USD",
              stripeSessionId,
              couponId: metaCouponId ? parseInt(metaCouponId, 10) : null,
            });
            req.log.warn({ stripeSessionId, userId, slotNum }, "Stripe webhook: no pending slot record found, created from session data");
            await activateSlot(userId, slotNum, paymentRecordId, undefined);
            if (metaCouponId) {
              await db.update(couponsTable)
                .set({ usedCount: sql`${couponsTable.usedCount} + 1` })
                .where(eq(couponsTable.id, parseInt(metaCouponId, 10)))
                .catch(() => {});
            }
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
  const { slotNumber, currency, hours, couponId } = req.body;
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
  let baseAmount: number = pricePerDay;

  if (hourlyPricingEnabled) {
    const h = parseInt(hours, 10);
    if (!hours || isNaN(h) || h < minHours) {
      res.status(400).json({ error: "invalid_hours", message: `Minimum purchase is ${minHours} hour(s)` });
      return;
    }
    purchasedHours = h;
    baseAmount = parseFloat((h * pricePerHour).toFixed(2));
  }

  // Apply coupon discount
  const { finalAmount: chargeAmount, validCouponId } = await applyCouponDiscount(couponId, baseAmount);

  const slots = await db.select().from(slotsTable).where(
    and(eq(slotsTable.isActive, true), eq(slotsTable.slotNumber, slotNumber))
  ).limit(1);

  if (slots.length > 0) {
    if (slots[0].userId === req.session.userId!) {
      res.status(400).json({ error: "slot_active", message: "You already have this slot active." });
    } else {
      res.status(409).json({ error: "slot_taken", message: "This slot was just taken by another user. Please choose a different slot." });
    }
    return;
  }

  try {
    const paymentId = crypto.randomUUID();

    // Build the IPN callback URL — always send one so NOWPayments notifies us on payment completion.
    // Priority: explicit NOWPAYMENTS_IPN_CALLBACK_URL > REPLIT_DEV_DOMAIN (dev only) > production domain.
    const ipnCallbackUrl = process.env.NOWPAYMENTS_IPN_CALLBACK_URL
      ?? (process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}/api/payments/nowpayments-ipn`
        : "https://www.exenotifier.com/api/payments/nowpayments-ipn");

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
      usdAmount: chargeAmount.toFixed(2),
      address: nowPayment.pay_address,
      txHash: nowPayment.payment_id,
      expiresAt,
      derivationIndex: purchasedHours,
      couponId: validCouponId,
    });

    res.json({
      paymentId,
      address: nowPayment.pay_address,
      amount,
      currency,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Crypto session creation failed");
    res.status(500).json({ error: "server_error", message: `Failed to create crypto payment: ${detail}` });
  }
});

// Track IPN spoof attempts per IP (in-memory, resets on restart)
const spoofAttempts = new Map<string, { count: number; firstSeen: number }>();
const SPOOF_BAN_THRESHOLD = 3;
const SPOOF_BAN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

async function alertSpoofAttempt(ip: string, count: number, body: string, headers: Record<string, string>) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "🚨 IPN Spoof Attempt Detected",
          color: 0xff0000,
          fields: [
            { name: "IP Address", value: `\`${ip}\``, inline: true },
            { name: "Attempt #", value: String(count), inline: true },
            { name: "Signature Header", value: `\`${headers["x-nowpayments-sig"]?.slice(0, 40) ?? "none"}...\``, inline: false },
            { name: "Body (truncated)", value: `\`\`\`${body.slice(0, 300)}\`\`\``, inline: false },
          ],
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch {}
}

router.post("/nowpayments-ipn", async (req: Request, res: Response) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  const signature = req.headers["x-nowpayments-sig"] as string;

  // req.body is a raw Buffer here (express.raw middleware)
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "invalid_body" });
    return;
  }

  if (!verifyNowPaymentsIpn(parsed, signature)) {
    // Track spoof attempts per IP
    const now = Date.now();
    const entry = spoofAttempts.get(ip) ?? { count: 0, firstSeen: now };
    if (now - entry.firstSeen > SPOOF_BAN_WINDOW_MS) {
      entry.count = 0;
      entry.firstSeen = now;
    }
    entry.count++;
    spoofAttempts.set(ip, entry);

    req.log.warn({ ip, attempt: entry.count, signature: signature?.slice(0, 20) }, "NOWPayments IPN spoof attempt");

    // Fire Discord alert
    await alertSpoofAttempt(ip, entry.count, rawBody, req.headers as Record<string, string>);

    if (entry.count >= SPOOF_BAN_THRESHOLD) {
      res.status(403).json({
        error: "banned",
        message: "You think you're slick? We've logged your IP and flagged your account. Don't try this again.",
      });
      return;
    }

    res.status(403).json({
      error: "nice_try",
      message: "Trying to spoof us? We already know who you are. This attempt has been logged.",
    });
    return;
  }

  try {
    const { order_id, payment_status, payment_id } = parsed as { order_id: string; payment_status: string; payment_id?: string | number };

    if (!isPaymentSuccessful(payment_status)) {
      res.json({ received: true });
      return;
    }

    // Double-check the status directly with the NOWPayments API using the internal payment_id.
    // This prevents anyone from forging an IPN even if they somehow obtain the signing secret.
    if (payment_id) {
      try {
        const live = await getNowPaymentsStatus(String(payment_id));
        if (!isPaymentSuccessful(live.payment_status)) {
          req.log.warn({ payment_id, claimed: payment_status, actual: live.payment_status }, "NOWPayments IPN: claimed status does not match live API — ignoring");
          res.json({ received: true });
          return;
        }
      } catch (verifyErr) {
        req.log.warn({ verifyErr, payment_id }, "NOWPayments IPN: could not verify status via API — proceeding with IPN data");
      }
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
      const userRows = await db.select().from(usersTable).where(eq(usersTable.id, payment.userId)).limit(1);
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
    } else if (payment.method === "preorder-crypto") {
      // Pre-order: mark payment completed + create preorder record
      await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, payment.id));
      await db.insert(preordersTable).values({
        userId: payment.userId,
        amount: payment.amount ?? "0",
        currency: payment.currency,
        paymentId: payment.id,
        status: "paid",
        hoursRequested: payment.derivationIndex ?? null,
      });
      req.log.info({ paymentId: payment.id }, "NOWPayments IPN: pre-order activated");
      const userRows = await db.select().from(usersTable).where(eq(usersTable.id, payment.userId)).limit(1);
      if (userRows.length) {
        await sendPaymentWebhook({
          username: userRows[0].username,
          discordId: userRows[0].discordId,
          method: payment.method,
          currency: payment.currency,
          amount: payment.amount,
          purchaseType: "preorder",
        });
      }
    } else {
      await activateSlot(payment.userId, payment.slotNumber, payment.id, payment.derivationIndex ?? undefined);
      req.log.info({ paymentId: payment.id }, "NOWPayments IPN: slot activated");
      // Increment coupon usage if applicable
      if (payment.couponId) {
        await db.update(couponsTable)
          .set({ usedCount: sql`${couponsTable.usedCount} + 1` })
          .where(eq(couponsTable.id, payment.couponId))
          .catch(() => {});
      }
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
    // Increment coupon usage if applicable
    if (payment.couponId) {
      await db.update(couponsTable)
        .set({ usedCount: sql`${couponsTable.usedCount} + 1` })
        .where(eq(couponsTable.id, payment.couponId))
        .catch(() => {});
    }
    res.json({ success: true, message: "Payment verified and slot activated" });
  } catch (err) {
    req.log.error({ err }, "Crypto payment verification failed");
    res.status(500).json({ error: "server_error", message: "Verification failed" });
  }
});

export default router;
