import { db, slotsTable, usersTable, bidsTable, preordersTable, paymentsTable } from "@workspace/db";
import { sql, eq, and, ne, desc, lt } from "drizzle-orm";
import { sendDiscordDM, sendPaymentWebhook } from "./discord.js";
import { isLuarmorConfigured, createLuarmorUser, deleteLuarmorUser } from "./luarmor.js";
import { getSettings } from "./settings.js";
import { logger } from "./logger.js";
import crypto from "crypto";

/** Deactivate all expired slots and remove their Luarmor keys */
export async function runSlotCleanup(): Promise<number> {
  const now = new Date();
  const expired = await db
    .select()
    .from(slotsTable)
    .where(and(eq(slotsTable.isActive, true), eq(slotsTable.isPaused, false), lt(slotsTable.expiresAt, now)));

  if (!expired.length) return 0;

  for (const slot of expired) {
    if (isLuarmorConfigured() && slot.luarmorUserId) {
      try {
        await deleteLuarmorUser(slot.luarmorUserId);
      } catch (e) {
        logger.warn({ e, slotId: slot.id }, "Luarmor deletion failed during cleanup");
      }
    }
    await db.update(slotsTable)
      .set({ isActive: false, expiresAt: null, purchasedAt: null, luarmorUserId: null, updatedAt: new Date() } as any)
      .where(eq(slotsTable.id, slot.id));

    logger.info({ slotId: slot.id, slotNumber: slot.slotNumber, userId: slot.userId }, "Slot expired and deactivated");
  }

  return expired.length;
}

/** Find the first available slot number for a given user */
async function findAvailableSlot(userId: string, slotCount: number): Promise<number | null> {
  const otherActive = await db
    .select({ slotNumber: slotsTable.slotNumber })
    .from(slotsTable)
    .where(and(eq(slotsTable.isActive, true), ne(slotsTable.userId, userId)));
  const busy = new Set(otherActive.map((s) => s.slotNumber));
  for (let i = 1; i <= slotCount; i++) {
    if (!busy.has(i)) return i;
  }
  return null;
}

/** Activate a slot for a user and return the Luarmor user_key if applicable */
async function activateSlot(userId: string, discordId: string, username: string, slotNum: number, expiresAt: Date): Promise<string | null> {
  const existing = await db
    .select()
    .from(slotsTable)
    .where(and(eq(slotsTable.userId, userId), eq(slotsTable.slotNumber, slotNum)))
    .limit(1);

  if (!existing.length) {
    await db.insert(slotsTable).values({ userId, slotNumber: slotNum, isActive: false });
  }

  let luarmorUserId: string | null = null;
  if (isLuarmorConfigured()) {
    try {
      const lu = await createLuarmorUser(discordId, username, expiresAt);
      luarmorUserId = lu.user_key;
    } catch (e) {
      logger.warn({ e }, "Luarmor user creation failed (auto-fulfill)");
    }
  }

  await db.update(slotsTable)
    .set({ isActive: true, expiresAt, purchasedAt: new Date(), luarmorUserId, notified24h: false, notified1h: false, updatedAt: new Date() } as any)
    .where(and(eq(slotsTable.userId, userId), eq(slotsTable.slotNumber, slotNum)));

  return luarmorUserId;
}

/**
 * Check for free slots and automatically assign them to the top bidder
 * (if bid > highest pre-order) or the top pre-orderer.
 * Safe to call multiple times — idempotent per free slot.
 */
export async function runAutoFulfillment(): Promise<void> {
  try {
    const { slotCount, slotDurationHours } = await getSettings();

    // Count active slots within the configured limit
    const activeSlots = await db
      .select({ slotNumber: slotsTable.slotNumber })
      .from(slotsTable)
      .where(eq(slotsTable.isActive, true));
    const activeCount = activeSlots.filter((s) => s.slotNumber <= slotCount).length;
    const freeSlots = slotCount - activeCount;

    if (freeSlots <= 0) return;

    // Get top active bid and top pre-order
    const topBids = await db
      .select()
      .from(bidsTable)
      .where(eq(bidsTable.status, "active"))
      .orderBy(desc(bidsTable.amount), bidsTable.createdAt);

    const topPreorderRows = await db
      .select()
      .from(preordersTable)
      .where(eq(preordersTable.status, "paid"))
      .orderBy(desc(preordersTable.amount))
      .limit(1);

    const topBid = topBids[0] ?? null;
    const topPreorder = topPreorderRows[0] ?? null;
    const topBidAmount = topBid ? parseFloat(topBid.amount) : 0;
    const topPreorderAmount = topPreorder ? parseFloat(topPreorder.amount) : 0;

    if (!topBid && !topPreorder) return;

    if (topBid && topBidAmount > topPreorderAmount) {
      // ── Fulfill top bid ──
      const winner = topBid;
      const losers = topBids.slice(1);

      const winnerUserRows = await db.select().from(usersTable).where(eq(usersTable.id, winner.userId)).limit(1);
      if (!winnerUserRows.length) return;
      const wu = winnerUserRows[0];

      const slotNum = await findAvailableSlot(winner.userId, slotCount);
      if (slotNum === null) return;

      const expiresAt = new Date(Date.now() + slotDurationHours * 60 * 60 * 1000);
      await activateSlot(winner.userId, wu.discordId, wu.username, slotNum, expiresAt);

      await db.insert(paymentsTable).values({
        id: crypto.randomUUID(),
        userId: winner.userId,
        slotNumber: slotNum,
        method: "bid-balance",
        status: "completed",
        amount: winner.amount,
        usdAmount: winner.amount,
        currency: "USD",
      });

      // Refund all losers
      for (const bid of losers) {
        const refund = parseFloat(bid.amount);
        await db.update(usersTable)
          .set({ balance: sql`${usersTable.balance} + ${refund.toFixed(2)}::numeric`, updatedAt: new Date() })
          .where(eq(usersTable.id, bid.userId));
      }

      // Clear all bids
      await db.delete(bidsTable);

      const ts = Math.floor(expiresAt.getTime() / 1000);
      try {
        await sendDiscordDM(wu.discordId,
          `🏆 **You won the bid!** Your Exe Joiner slot #${slotNum} is now active and expires <t:${ts}:F>. Check the dashboard for your key.`
        );
        if (losers.length) {
          // Notify losers they were refunded
          for (const bid of losers) {
            const loserRows = await db.select({ discordId: usersTable.discordId, username: usersTable.username })
              .from(usersTable).where(eq(usersTable.id, bid.userId)).limit(1);
            if (loserRows.length) {
              await sendDiscordDM(loserRows[0].discordId,
                `💸 A slot opened and went to a higher bidder. Your bid of **$${parseFloat(bid.amount).toFixed(2)}** has been refunded to your balance.`
              ).catch(() => {});
            }
          }
        }
        await sendPaymentWebhook({
          username: wu.username,
          discordId: wu.discordId,
          method: "balance",
          currency: "USD",
          amount: winner.amount,
          purchaseType: "slot",
        });
      } catch (e) {
        logger.warn({ e }, "Auto bid fulfill notification failed");
      }

      logger.info({ userId: winner.userId, slotNum, amount: winner.amount }, "Auto-fulfilled bid");

    } else if (topPreorder) {
      // ── Fulfill top pre-order ──
      const preorder = topPreorder;

      const preorderUserRows = await db.select().from(usersTable).where(eq(usersTable.id, preorder.userId)).limit(1);
      if (!preorderUserRows.length) return;
      const pu = preorderUserRows[0];

      const slotNum = await findAvailableSlot(preorder.userId, slotCount);
      if (slotNum === null) return;

      const hoursToUse = preorder.hoursRequested ?? slotDurationHours;
      const expiresAt = new Date(Date.now() + hoursToUse * 60 * 60 * 1000);
      await activateSlot(preorder.userId, pu.discordId, pu.username, slotNum, expiresAt);

      // Mark pre-order as fulfilled
      await db.execute(sql`UPDATE preorders SET status = 'fulfilled' WHERE id = ${preorder.id}`);

      await db.insert(paymentsTable).values({
        id: crypto.randomUUID(),
        userId: preorder.userId,
        slotNumber: slotNum,
        method: "preorder-fulfilled",
        status: "completed",
        amount: preorder.amount,
        usdAmount: preorder.amount,
        currency: preorder.currency ?? "USD",
      });

      const ts = Math.floor(expiresAt.getTime() / 1000);
      try {
        await sendDiscordDM(pu.discordId,
          `🎉 **Your pre-order has been fulfilled!** Slot #${slotNum} is now active and expires <t:${ts}:F>. Check the dashboard for your key.`
        );
        await sendPaymentWebhook({
          username: pu.username,
          discordId: pu.discordId,
          method: "balance",
          currency: preorder.currency ?? "USD",
          amount: preorder.amount,
          purchaseType: "preorder",
        });
      } catch (e) {
        logger.warn({ e }, "Auto preorder fulfill notification failed");
      }

      logger.info({ userId: preorder.userId, slotNum, amount: preorder.amount }, "Auto-fulfilled preorder");
    }
  } catch (err) {
    logger.warn({ err }, "Auto-fulfillment job failed");
  }
}
