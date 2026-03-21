import { Router } from "express";
import { db, slotsTable, usersTable, paymentsTable } from "@workspace/db";
import { eq, and, sql, inArray, lte, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getSettings } from "../lib/settings.js";

const router = Router();

router.patch("/:id/label", requireAuth, async (req, res) => {
  const slotId = parseInt(req.params.id, 10);
  const { label } = req.body as { label?: string };

  if (isNaN(slotId)) {
    res.status(400).json({ error: "invalid_slot", message: "Invalid slot ID" });
    return;
  }

  try {
    const existing = await db.select().from(slotsTable).where(eq(slotsTable.id, slotId)).limit(1);

    if (!existing.length || existing[0].userId !== req.session.userId) {
      res.status(404).json({ error: "not_found", message: "Slot not found" });
      return;
    }

    await db.update(slotsTable).set({ label: label?.trim() || null }).where(eq(slotsTable.id, slotId));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update slot label");
    res.status(500).json({ error: "server_error", message: "Failed to update slot" });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const { slotCount, pricePerDay } = await getSettings();
    const currentUserId = req.session.userId!;

    // Ensure current user has slot rows
    const userSlots = await db.select().from(slotsTable).where(eq(slotsTable.userId, currentUserId));
    const existingNums = new Set(userSlots.map((s) => s.slotNumber));
    const toCreate = [];
    for (let i = 1; i <= slotCount; i++) {
      if (!existingNums.has(i)) toCreate.push({ userId: currentUserId, slotNumber: i, isActive: false });
    }
    if (toCreate.length) await db.insert(slotsTable).values(toCreate);

    // Get ALL active slots (any user) within range
    const allActiveSlots = await db
      .select()
      .from(slotsTable)
      .where(and(eq(slotsTable.isActive, true), lte(slotsTable.slotNumber, slotCount)));

    // Get owners for active slots
    const ownerIds = [...new Set(allActiveSlots.map((s) => s.userId))];
    const owners: Record<string, { username: string; discordId: string; avatar: string | null }> = {};
    if (ownerIds.length) {
      const ownerRows = await db
        .select({ id: usersTable.id, username: usersTable.username, discordId: usersTable.discordId, avatar: usersTable.avatar })
        .from(usersTable)
        .where(inArray(usersTable.id, ownerIds));
      for (const o of ownerRows) owners[o.id] = { username: o.username, discordId: o.discordId, avatar: o.avatar };
    }

    // Get current user's own slot rows for private details
    const mySlots = await db
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.userId, currentUserId))
      .orderBy(slotsTable.slotNumber);

    const mySlotMap = Object.fromEntries(mySlots.map((s) => [s.slotNumber, s]));

    // Build unified response for each slot number
    const slots = Array.from({ length: slotCount }, (_, i) => {
      const num = i + 1;
      const mySlot = mySlotMap[num];
      const activeSlot = allActiveSlots.find((s) => s.slotNumber === num);

      if (mySlot?.isActive) {
        // Current user owns this slot
        return {
          slotNumber: num,
          isActive: true,
          isOwner: true,
          owner: owners[currentUserId] ?? null,
          id: mySlot.id,
          purchasedAt: mySlot.purchasedAt?.toISOString() ?? null,
          expiresAt: mySlot.expiresAt?.toISOString() ?? null,
          label: mySlot.label,
        };
      } else if (activeSlot) {
        // Someone else owns this slot
        return {
          slotNumber: num,
          isActive: true,
          isOwner: false,
          owner: owners[activeSlot.userId] ?? null,
          id: null,
          purchasedAt: null,
          expiresAt: null,
          label: null,
        };
      } else {
        // Slot is free
        return {
          slotNumber: num,
          isActive: false,
          isOwner: false,
          owner: null,
          id: mySlot?.id ?? null,
          purchasedAt: null,
          expiresAt: null,
          label: null,
        };
      }
    });

    res.json({ slots, totalSlots: slotCount, pricePerDay });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch slots");
    res.status(500).json({ error: "server_error", message: "Failed to fetch slots" });
  }
});

router.get("/leaderboard", requireAuth, async (req, res) => {
  try {
    const { slotDurationHours } = await getSettings();

    const completedPayments = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.status, "completed"));

    const users = await db.select().from(usersTable);
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    const totals: Record<string, { userId: string; totalSpent: number; totalHours: number }> = {};
    for (const p of completedPayments) {
      if (!totals[p.userId]) totals[p.userId] = { userId: p.userId, totalSpent: 0, totalHours: 0 };
      const amt = parseFloat(p.amount ?? "0");
      totals[p.userId].totalSpent += isNaN(amt) ? 0 : amt;
      totals[p.userId].totalHours += slotDurationHours;
    }

    const leaderboard = Object.values(totals)
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 20)
      .map((entry, idx) => {
        const u = userMap[entry.userId];
        return {
          rank: idx + 1,
          username: u?.username ?? "Unknown",
          discordId: u?.discordId ?? "",
          avatar: u?.avatar ?? null,
          totalSpent: parseFloat(entry.totalSpent.toFixed(2)),
          totalHours: entry.totalHours,
        };
      });

    res.json({ leaderboard });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch leaderboard");
    res.status(500).json({ error: "server_error", message: "Failed to fetch leaderboard" });
  }
});

router.get("/history", requireAuth, async (req, res) => {
  try {
    const payments = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.userId, req.session.userId!))
      .orderBy(desc(paymentsTable.createdAt));

    res.json({
      payments: payments.map((p) => ({
        id: p.id,
        slotNumber: p.slotNumber,
        method: p.method,
        currency: p.currency,
        amount: p.amount,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch payment history");
    res.status(500).json({ error: "server_error", message: "Failed to fetch history" });
  }
});

export default router;
