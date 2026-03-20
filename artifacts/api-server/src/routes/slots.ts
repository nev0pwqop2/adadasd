import { Router } from "express";
import { db, slotsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getSettings } from "../lib/settings.js";

const router = Router();

async function ensureUserSlots(userId: string, totalSlots: number) {
  const existing = await db.select().from(slotsTable).where(eq(slotsTable.userId, userId));
  const existingNumbers = new Set(existing.map((s) => s.slotNumber));

  const toCreate = [];
  for (let i = 1; i <= totalSlots; i++) {
    if (!existingNumbers.has(i)) {
      toCreate.push({ userId, slotNumber: i, isActive: false });
    }
  }

  if (toCreate.length > 0) {
    await db.insert(slotsTable).values(toCreate);
  }
}

router.patch("/:id/label", requireAuth, async (req, res) => {
  const slotId = parseInt(req.params.id, 10);
  const { label } = req.body as { label?: string };

  if (isNaN(slotId)) {
    res.status(400).json({ error: "invalid_slot", message: "Invalid slot ID" });
    return;
  }

  try {
    const existing = await db.select().from(slotsTable).where(
      eq(slotsTable.id, slotId)
    ).limit(1);

    if (!existing.length || existing[0].userId !== req.session.userId) {
      res.status(404).json({ error: "not_found", message: "Slot not found" });
      return;
    }

    await db.update(slotsTable)
      .set({ label: label?.trim() || null })
      .where(eq(slotsTable.id, slotId));

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update slot label");
    res.status(500).json({ error: "server_error", message: "Failed to update slot" });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const { slotCount, pricePerDay } = await getSettings();
    await ensureUserSlots(req.session.userId!, slotCount);

    const slots = await db
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.userId, req.session.userId!))
      .orderBy(slotsTable.slotNumber);

    const filtered = slots.filter((s) => s.slotNumber <= slotCount);

    res.json({
      slots: filtered.map((s) => ({
        id: s.id,
        slotNumber: s.slotNumber,
        isActive: s.isActive,
        purchasedAt: s.purchasedAt?.toISOString() ?? null,
        expiresAt: s.expiresAt?.toISOString() ?? null,
        label: s.label,
      })),
      totalSlots: slotCount,
      pricePerDay,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch slots");
    res.status(500).json({ error: "server_error", message: "Failed to fetch slots" });
  }
});

export default router;
