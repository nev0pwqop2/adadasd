import { Router } from "express";
import { db, slotsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { getSettings, setSetting } from "../lib/settings.js";
import { isLuarmorConfigured, deleteLuarmorUser } from "../lib/luarmor.js";

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
    const { slotCount, pricePerDay, slotDurationHours } = req.body;

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

    if (slotDurationHours !== undefined) {
      const hours = parseInt(slotDurationHours, 10);
      if (isNaN(hours) || hours < 1 || hours > 720) {
        res.status(400).json({ error: "invalid_value", message: "slotDurationHours must be 1–720" });
        return;
      }
      await setSetting("slotDurationHours", String(hours));
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

router.get("/slots", async (req, res) => {
  try {
    const { slotCount } = await getSettings();
    const allActive = await db
      .select()
      .from(slotsTable)
      .where(sql`${slotsTable.isActive} = true AND ${slotsTable.slotNumber} <= ${slotCount}`);

    const ownerIds = [...new Set(allActive.map((s) => s.userId))];
    const owners: Record<string, { username: string; discordId: string; avatar: string | null }> = {};
    if (ownerIds.length) {
      const ownerRows = await db
        .select({ id: usersTable.id, username: usersTable.username, discordId: usersTable.discordId, avatar: usersTable.avatar })
        .from(usersTable)
        .where(sql`${usersTable.id} = ANY(${ownerIds})`);
      for (const o of ownerRows) owners[o.id] = { username: o.username, discordId: o.discordId, avatar: o.avatar };
    }

    const slots = Array.from({ length: slotCount }, (_, i) => {
      const num = i + 1;
      const active = allActive.find((s) => s.slotNumber === num);
      return {
        slotNumber: num,
        isActive: !!active,
        owner: active ? (owners[active.userId] ?? null) : null,
        expiresAt: active?.expiresAt?.toISOString() ?? null,
        purchasedAt: active?.purchasedAt?.toISOString() ?? null,
      };
    });

    res.json({ slots });
  } catch (err) {
    req.log.error({ err }, "Failed to get admin slots");
    res.status(500).json({ error: "server_error", message: "Failed to get slots" });
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
    const { slotCount, slotDurationHours } = await getSettings();
    const expiryMs = slotDurationHours * 60 * 60 * 1000;

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
          expiresAt: shouldBeActive ? new Date(Date.now() + expiryMs) : null,
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
    if (isLuarmorConfigured()) {
      const activeSlots = await db.select().from(slotsTable).where(sql`${slotsTable.isActive} = true AND ${slotsTable.luarmorUserId} IS NOT NULL`);
      await Promise.allSettled(
        activeSlots.filter((s) => s.luarmorUserId).map((s) => deleteLuarmorUser(s.luarmorUserId!))
      );
    }

    await db.update(slotsTable).set({ isActive: false, purchasedAt: null, expiresAt: null, luarmorUserId: null });
    req.log.info({ adminId: req.session.userId }, "All slots reset by admin");
    res.json({ success: true, message: "All slots have been reset" });
  } catch (err) {
    req.log.error({ err }, "Failed to reset all slots");
    res.status(500).json({ error: "server_error", message: "Failed to reset slots" });
  }
});

export default router;
