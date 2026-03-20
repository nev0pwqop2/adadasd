import { Router } from "express";
import { db, slotsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

const TOTAL_SLOTS = 6;

async function ensureUserSlots(userId: string) {
  const existing = await db.select().from(slotsTable).where(eq(slotsTable.userId, userId));
  const existingNumbers = new Set(existing.map((s) => s.slotNumber));

  const toCreate = [];
  for (let i = 1; i <= TOTAL_SLOTS; i++) {
    if (!existingNumbers.has(i)) {
      toCreate.push({
        userId,
        slotNumber: i,
        isActive: false,
      });
    }
  }

  if (toCreate.length > 0) {
    await db.insert(slotsTable).values(toCreate);
  }
}

router.get("/", requireAuth, async (req, res) => {
  try {
    await ensureUserSlots(req.session.userId!);
    const slots = await db
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.userId, req.session.userId!))
      .orderBy(slotsTable.slotNumber);

    res.json({
      slots: slots.map((s) => ({
        id: s.id,
        slotNumber: s.slotNumber,
        isActive: s.isActive,
        purchasedAt: s.purchasedAt?.toISOString() ?? null,
        expiresAt: s.expiresAt?.toISOString() ?? null,
        label: s.label,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch slots");
    res.status(500).json({ error: "server_error", message: "Failed to fetch slots" });
  }
});

export default router;
