import { Router } from "express";
import { db, slotsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { getSettings, setSetting } from "../lib/settings.js";

const router = Router();

router.use(requireAdmin);

router.get("/settings", async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    req.log.error({ err }, "Failed to get admin settings");
    res.status(500).json({ error: "server_error", message: "Failed to get settings" });
  }
});

router.post("/settings", async (req, res) => {
  try {
    const { slotCount, pricePerDay } = req.body;

    if (slotCount !== undefined) {
      const count = parseInt(slotCount, 10);
      if (isNaN(count) || count < 1 || count > 100) {
        res.status(400).json({ error: "invalid_value", message: "slotCount must be 1–100" });
        return;
      }
      await setSetting("slotCount", String(count));
    }

    if (pricePerDay !== undefined) {
      const price = parseFloat(pricePerDay);
      if (isNaN(price) || price < 0) {
        res.status(400).json({ error: "invalid_value", message: "pricePerDay must be >= 0" });
        return;
      }
      await setSetting("pricePerDay", price.toFixed(2));
    }

    const updated = await getSettings();
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update admin settings");
    res.status(500).json({ error: "server_error", message: "Failed to update settings" });
  }
});

router.get("/users", async (req, res) => {
  try {
    const { slotCount } = await getSettings();
    const users = await db.select().from(usersTable);
    const allSlots = await db.select().from(slotsTable);

    const result = users.map((u) => {
      const userSlots = allSlots.filter((s) => s.userId === u.id && s.slotNumber <= slotCount);
      return {
        discordId: u.discordId,
        username: u.username,
        avatar: u.avatar,
        activeSlots: userSlots.filter((s) => s.isActive).length,
        totalSlots: slotCount,
      };
    });

    res.json({ users: result });
  } catch (err) {
    req.log.error({ err }, "Failed to get admin users");
    res.status(500).json({ error: "server_error", message: "Failed to get users" });
  }
});

router.post("/users/:discordId/slots", async (req, res) => {
  try {
    const { discordId } = req.params;
    const { activeSlotCount } = req.body;

    if (activeSlotCount === undefined || typeof activeSlotCount !== "number") {
      res.status(400).json({ error: "invalid_request", message: "activeSlotCount is required" });
      return;
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.discordId, discordId)).limit(1);
    if (!users.length) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }

    const userId = users[0].id;
    const { slotCount } = await getSettings();

    const existingSlots = await db.select().from(slotsTable).where(eq(slotsTable.userId, userId));
    const existingNumbers = new Set(existingSlots.map((s) => s.slotNumber));

    for (let i = 1; i <= slotCount; i++) {
      if (!existingNumbers.has(i)) {
        await db.insert(slotsTable).values({ userId, slotNumber: i, isActive: false });
      }
    }

    const count = Math.min(activeSlotCount, slotCount);

    const slots = await db.select().from(slotsTable).where(eq(slotsTable.userId, userId));
    for (const slot of slots) {
      if (slot.slotNumber > slotCount) continue;
      const shouldBeActive = slot.slotNumber <= count;
      if (slot.isActive !== shouldBeActive) {
        await db.update(slotsTable).set({
          isActive: shouldBeActive,
          purchasedAt: shouldBeActive ? new Date() : null,
          expiresAt: shouldBeActive ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null,
        }).where(eq(slotsTable.id, slot.id));
      }
    }

    res.json({ success: true, message: `Set ${count} active slots for ${discordId}` });
  } catch (err) {
    req.log.error({ err }, "Failed to update user slots");
    res.status(500).json({ error: "server_error", message: "Failed to update user slots" });
  }
});

router.post("/reset-all-slots", async (req, res) => {
  try {
    await db.update(slotsTable).set({
      isActive: false,
      purchasedAt: null,
      expiresAt: null,
    });
    req.log.info({ adminId: req.session.userId }, "All slots reset by admin");
    res.json({ success: true, message: "All slots have been reset" });
  } catch (err) {
    req.log.error({ err }, "Failed to reset all slots");
    res.status(500).json({ error: "server_error", message: "Failed to reset slots" });
  }
});

export default router;
