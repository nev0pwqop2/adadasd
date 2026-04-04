import { db, paymentsTable, usersTable, slotsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
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
) {
  const { slotDurationHours } = await getSettings();
  const hours = durationHoursOverride ?? slotDurationHours;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  await db.update(paymentsTable)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(paymentsTable.id, paymentId));

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

  logger.info({ paymentId, userId, slotNumber, hours, luarmorUserId }, "Slot activated");
}
