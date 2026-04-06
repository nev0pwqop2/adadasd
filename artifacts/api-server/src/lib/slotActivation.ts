import { db, paymentsTable, usersTable, slotsTable } from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { getSettings } from "./settings.js";
import { isLuarmorConfigured, createLuarmorUser } from "./luarmor.js";
import { sendPaymentWebhook, sendDiscordDM } from "./discord.js";
import { generateSlotToken } from "./slotToken.js";

export async function activateSlotShared(
  userId: string,
  slotNumber: number,
  paymentId: string,
  durationHoursOverride?: number,
): Promise<{ slotTaken: boolean; alreadyProcessed?: boolean }> {
  const { slotDurationHours } = await getSettings();
  const hours = durationHoursOverride ?? slotDurationHours;

  // Check if another user already has this slot active (race condition guard)
  const takenBy = await db.select({ userId: slotsTable.userId })
    .from(slotsTable)
    .where(and(
      eq(slotsTable.slotNumber, slotNumber),
      eq(slotsTable.isActive, true),
      ne(slotsTable.userId, userId),
    ))
    .limit(1);

  if (takenBy.length > 0) {
    // Refund the payment amount back to the user's balance
    const paymentRows = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId)).limit(1);
    const refundAmount = parseFloat(paymentRows[0]?.usdAmount ?? paymentRows[0]?.amount ?? "0");

    await db.update(paymentsTable)
      .set({ status: "refunded", updatedAt: new Date() })
      .where(eq(paymentsTable.id, paymentId));

    if (refundAmount > 0) {
      await db.update(usersTable)
        .set({ balance: sql`${usersTable.balance} + ${refundAmount.toFixed(2)}::numeric`, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));
    }

    const userRows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (userRows.length) {
      sendDiscordDM(userRows[0].discordId,
        `⚠️ **Slot #${slotNumber} was just taken by someone else!**\n💸 Your payment of $${refundAmount.toFixed(2)} has been refunded to your balance.\nChoose a different slot or try again.`
      ).catch(() => {});
    }

    logger.warn({ paymentId, userId, slotNumber }, "Slot activation aborted — slot taken by another user, payment refunded");
    return { slotTaken: true };
  }

  // Atomically claim the payment — only one process wins, prevents double-processing
  // between the poller and the webhook firing at the same time.
  const claimed = await db.update(paymentsTable)
    .set({ status: "completed", updatedAt: new Date() })
    .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.status, "pending")))
    .returning({ id: paymentsTable.id });

  if (claimed.length === 0) {
    // Another process (webhook or poller) already completed this payment — skip silently
    logger.info({ paymentId }, "activateSlotShared: payment already processed by another handler, skipping");
    return { slotTaken: false, alreadyProcessed: true };
  }

  // Payment claimed — now activate the slot. If this fails, revert to pending so next poll retries.
  try {
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const userRows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    const user = userRows[0];

    let luarmorUserId: string | null = null;
    if (isLuarmorConfigured() && user) {
      try {
        const luarmorUser = await createLuarmorUser(user.discordId, user.username, expiresAt);
        luarmorUserId = luarmorUser.user_key;
      } catch {
        // Luarmor failure should not block slot activation
      }
    }

    const existing = await db.select()
      .from(slotsTable)
      .where(and(eq(slotsTable.userId, userId), eq(slotsTable.slotNumber, slotNumber)))
      .limit(1);

    const purchasedAt = new Date();
    const slotData = {
      isActive: true,
      purchasedAt,
      expiresAt,
      purchaseToken: generateSlotToken(userId, slotNumber, purchasedAt),
      ...(luarmorUserId ? { luarmorUserId } : {}),
    };

    if (existing.length > 0) {
      await db.update(slotsTable).set(slotData)
        .where(and(eq(slotsTable.userId, userId), eq(slotsTable.slotNumber, slotNumber)));
    } else {
      await db.insert(slotsTable).values({ userId, slotNumber, ...slotData });
    }

    if (user) {
      const paymentRows = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId)).limit(1);
      if (paymentRows.length) {
        const p = paymentRows[0];
        await sendPaymentWebhook({
          username: user.username,
          discordId: user.discordId,
          method: p.method,
          currency: p.currency,
          amount: p.amount,
          slotNumber,
          purchaseType: "slot",
          durationHours: hours,
          expiresAt,
        }).catch(() => {});

        const ts = Math.floor(expiresAt.getTime() / 1000);
        const keyLine = luarmorUserId
          ? `\n🔑 **Your script key:** \`${luarmorUserId}\``
          : `\n🔑 Get your script key from the dashboard.`;
        sendDiscordDM(user.discordId,
          `✅ **Slot #${slotNumber} is now active!**${keyLine}\n⏰ Expires <t:${ts}:F>.`
        ).catch(() => {});
      }
    }

    logger.info({ paymentId, userId, slotNumber, hours, luarmorUserId }, "Slot activated");
    return { slotTaken: false };

  } catch (err) {
    // Slot activation failed after we already claimed the payment — revert to pending so the poller retries
    logger.error({ err, paymentId, userId, slotNumber }, "Slot activation failed after payment claim — reverting to pending for retry");
    await db.update(paymentsTable)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(paymentsTable.id, paymentId))
      .catch(revertErr => logger.error({ revertErr, paymentId }, "Failed to revert payment status to pending"));
    throw err;
  }
}
