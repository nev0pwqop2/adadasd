import { db, paymentsTable, usersTable, slotsTable } from "@workspace/db";
import { eq, and, inArray, gte, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { getSettings } from "./settings.js";
import { generateSlotToken } from "./slotToken.js";
import { sendPaymentWebhook } from "./discord.js";
import { activateSlotShared } from "./slotActivation.js";

async function completeBalanceDeposit(
  paymentId: string,
  userId: string,
  method: string,
  currency: string | null,
  amount: string | null,
) {
  const depositAmount = parseFloat(amount ?? "0");
  if (depositAmount <= 0) return;

  await db.update(paymentsTable)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(paymentsTable.id, paymentId));

  await db.update(usersTable)
    .set({ balance: sql`${usersTable.balance} + ${depositAmount.toFixed(2)}::numeric`, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));

  const userRows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (userRows.length) {
    await sendPaymentWebhook({
      username: userRows[0].username,
      discordId: userRows[0].discordId,
      method,
      currency: currency ?? "USD",
      amount: depositAmount.toFixed(2),
      purchaseType: "balance_deposit",
    }).catch(() => {});
  }

  logger.info({ paymentId, userId, depositAmount }, "Payment poller: balance deposit auto-completed");
}

async function completeSlotPayment(
  paymentId: string,
  userId: string,
  slotNumber: number,
  method: string,
  currency: string | null,
  amount: string | null,
  derivationIndex: number | null,
) {
  const { slotDurationHours } = await getSettings();
  const hours = derivationIndex ?? slotDurationHours;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const purchasedAt = new Date();

  await db.update(paymentsTable)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(paymentsTable.id, paymentId));

  const existing = await db.select()
    .from(slotsTable)
    .where(and(eq(slotsTable.userId, userId), eq(slotsTable.slotNumber, slotNumber)))
    .limit(1);

  const slotData = {
    isActive: true,
    purchasedAt,
    expiresAt,
    purchaseToken: generateSlotToken(userId, slotNumber, purchasedAt),
  };

  if (existing.length) {
    await db.update(slotsTable).set(slotData)
      .where(and(eq(slotsTable.userId, userId), eq(slotsTable.slotNumber, slotNumber)));
  } else {
    await db.insert(slotsTable).values({ userId, slotNumber, ...slotData });
  }

  const userRows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (userRows.length) {
    await sendPaymentWebhook({
      username: userRows[0].username,
      discordId: userRows[0].discordId,
      method,
      currency: currency ?? "USD",
      amount,
      slotNumber,
      purchaseType: "slot",
      durationHours: hours,
      expiresAt,
    }).catch(() => {});
  }

  logger.info({ paymentId, userId, slotNumber }, "Payment poller: slot payment auto-completed");
}

async function pollStripePending(stripeKey: string) {
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(stripeKey);

  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const pending = await db.select()
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.status, "pending"),
        inArray(paymentsTable.method, ["stripe", "balance-deposit-stripe", "preorder-stripe"]),
        gte(paymentsTable.createdAt, cutoff),
      )
    )
    .limit(30);

  for (const payment of pending) {
    if (!payment.stripeSessionId) continue;
    try {
      const session = await stripe.checkout.sessions.retrieve(payment.stripeSessionId);
      if (session.payment_status !== "paid") continue;

      const isBalanceDeposit = payment.method === "balance-deposit-stripe";

      if (isBalanceDeposit) {
        await completeBalanceDeposit(
          payment.id, payment.userId, payment.method,
          "USD", payment.amount,
        );
      } else if (payment.method === "stripe" && payment.slotNumber > 0) {
        await activateSlotShared(
          payment.userId, payment.slotNumber, payment.id, payment.derivationIndex ?? undefined,
        );
      } else {
        await db.update(paymentsTable)
          .set({ status: "completed", updatedAt: new Date() })
          .where(eq(paymentsTable.id, payment.id));
        logger.info({ paymentId: payment.id, method: payment.method }, "Payment poller: stripe payment marked complete");
      }
    } catch (err) {
      logger.warn({ err, paymentId: payment.id }, "Payment poller: stripe check failed for payment");
    }
    await new Promise(r => setTimeout(r, 150));
  }
}

async function pollCryptoPending(apiKey: string) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // look back 7 days
  const pending = await db.select()
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.status, "pending"),
        inArray(paymentsTable.method, ["crypto", "balance-deposit-crypto"]),
        gte(paymentsTable.createdAt, cutoff),
      )
    )
    .limit(50);

  for (const payment of pending) {
    if (!payment.txHash) continue;
    try {
      const res = await fetch(`https://api.nowpayments.io/v1/payment/${payment.txHash}`, {
        headers: { "x-api-key": apiKey },
      });
      if (!res.ok) continue;
      const data = await res.json() as {
        payment_status: string;
        actually_paid?: number;
        actually_paid_usd_amount?: number;
        pay_amount?: number;
        pay_currency?: string;
      };

      const { payment_status, actually_paid, actually_paid_usd_amount } = data;
      const confirmed = payment_status === "finished" || payment_status === "confirmed";
      const partiallyPaid = payment_status === "partially_paid" && (actually_paid ?? 0) > 0;

      if (!confirmed && !partiallyPaid) continue;

      const isBalanceDeposit = payment.method === "balance-deposit-crypto";

      if (isBalanceDeposit) {
        // Use actually paid USD amount for accuracy — credit what they actually sent
        const creditAmount = actually_paid_usd_amount
          ? String(actually_paid_usd_amount)
          : (payment.usdAmount ?? payment.amount);
        await completeBalanceDeposit(
          payment.id, payment.userId, payment.method,
          payment.currency, creditAmount,
        );
      } else if (payment.slotNumber > 0) {
        if (!confirmed) continue; // Don't give slot for partial payment
        await activateSlotShared(
          payment.userId, payment.slotNumber, payment.id, payment.derivationIndex ?? undefined,
        );
      } else {
        await db.update(paymentsTable)
          .set({ status: "completed", updatedAt: new Date() })
          .where(eq(paymentsTable.id, payment.id));
      }
    } catch (err) {
      logger.warn({ err, paymentId: payment.id }, "Payment poller: crypto check failed for payment");
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

export async function runPaymentPoller() {
  const nowKey = process.env.NOWPAYMENTS_API_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  try {
    if (nowKey) await pollCryptoPending(nowKey);
  } catch (err) {
    logger.warn({ err }, "Payment poller: crypto polling error");
  }

  try {
    if (stripeKey) await pollStripePending(stripeKey);
  } catch (err) {
    logger.warn({ err }, "Payment poller: stripe polling error");
  }
}
