import { db, slotsTable, usersTable } from "@workspace/db";
import { eq, and, eq as drizzleEq } from "drizzle-orm";
import { sendDiscordDM } from "./discord.js";
import { logger } from "./logger.js";

const VOUCH_CHANNEL_ID = "1461450196377403472";
const TEN_MINUTES_MS = 10 * 60 * 1000;

const scheduledTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function schedule10mDM(slotId: string, userId: string, expiresAt: Date): Promise<void> {
  if (scheduledTimers.has(slotId)) {
    clearTimeout(scheduledTimers.get(slotId)!);
    scheduledTimers.delete(slotId);
  }

  const fireAt = expiresAt.getTime() - TEN_MINUTES_MS;
  const delay = fireAt - Date.now();

  if (delay <= 0) {
    return;
  }

  const timer = setTimeout(async () => {
    scheduledTimers.delete(slotId);
    try {
      const userRows = await db
        .select({ discordId: usersTable.discordId })
        .from(usersTable)
        .where(drizzleEq(usersTable.id, userId))
        .limit(1);
      if (!userRows.length) return;

      const slotRows = await db
        .select({ notified10m: slotsTable.notified10m, isActive: slotsTable.isActive })
        .from(slotsTable)
        .where(eq(slotsTable.id, slotId))
        .limit(1);
      if (!slotRows.length || !slotRows[0].isActive || slotRows[0].notified10m) return;

      await sendDiscordDM(userRows[0].discordId, `Make sure to vouch all your steals! <#${VOUCH_CHANNEL_ID}>`);
      await db.update(slotsTable).set({ notified10m: true } as any).where(eq(slotsTable.id, slotId));
      logger.info({ slotId, userId }, "10m expiry DM sent");
    } catch (err) {
      logger.warn({ err, slotId }, "Failed to send 10m expiry DM");
    }
  }, delay);

  scheduledTimers.set(slotId, timer);
  logger.info({ slotId, fireInSeconds: Math.round(delay / 1000) }, "Scheduled 10m expiry DM");
}

export function cancel10mDM(slotId: string): void {
  if (scheduledTimers.has(slotId)) {
    clearTimeout(scheduledTimers.get(slotId)!);
    scheduledTimers.delete(slotId);
    logger.info({ slotId }, "Cancelled 10m expiry DM timer");
  }
}

export async function scheduleAllActive10mDMs(): Promise<void> {
  try {
    const now = new Date();
    const active = await db
      .select({ id: slotsTable.id, userId: slotsTable.userId, expiresAt: slotsTable.expiresAt, notified10m: slotsTable.notified10m })
      .from(slotsTable)
      .where(and(eq(slotsTable.isActive, true)));

    let scheduled = 0;
    for (const slot of active) {
      if (!slot.expiresAt || slot.notified10m) continue;
      const fireAt = slot.expiresAt.getTime() - TEN_MINUTES_MS;
      if (fireAt <= now.getTime()) continue;
      await schedule10mDM(slot.id, slot.userId, slot.expiresAt);
      scheduled++;
    }
    logger.info({ scheduled }, "Scheduled 10m expiry DMs for active slots on startup");
  } catch (err) {
    logger.warn({ err }, "Failed to schedule startup 10m DMs");
  }
}
