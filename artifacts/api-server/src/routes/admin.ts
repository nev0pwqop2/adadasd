import { Router } from "express";
import { db, slotsTable, usersTable, paymentsTable } from "@workspace/db";
import { eq, sql, inArray, and, lte, isNotNull } from "drizzle-orm";
import { requireAdmin, isSuperAdmin, SUPER_ADMIN_DISCORD_ID } from "../middlewares/requireAdmin.js";
import { getSettings, setSetting } from "../lib/settings.js";
import { isLuarmorConfigured, createLuarmorUser, deleteLuarmorUser, getLuarmorUsers } from "../lib/luarmor.js";
import { sendPaymentWebhook } from "../lib/discord.js";

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
    const { slotCount, pricePerDay, slotDurationHours, hourlyPricingEnabled, pricePerHour, minHours } = req.body;

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

    if (hourlyPricingEnabled !== undefined) {
      await setSetting("hourlyPricingEnabled", hourlyPricingEnabled ? "true" : "false");
    }

    if (pricePerHour !== undefined) {
      const price = parseFloat(pricePerHour);
      if (isNaN(price) || price < 0) {
        res.status(400).json({ error: "invalid_value", message: "pricePerHour must be >= 0" });
        return;
      }
      await setSetting("pricePerHour", price.toFixed(2));
    }

    if (minHours !== undefined) {
      const min = parseInt(minHours, 10);
      if (isNaN(min) || min < 1 || min > 720) {
        res.status(400).json({ error: "invalid_value", message: "minHours must be 1–720" });
        return;
      }
      await setSetting("minHours", String(min));
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
        isAdmin: u.isAdmin || isSuperAdmin(u.discordId),
        isSuperAdmin: isSuperAdmin(u.discordId),
        activeSlots: userSlots.filter((s) => s.isActive).length,
        totalSlots: slotCount,
        guilds: (u.guilds as any[] | null) ?? [],
      };
    });

    res.json({ users: result });
  } catch (err) {
    req.log.error({ err }, "Failed to get admin users");
    res.status(500).json({ error: "server_error", message: "Failed to get users" });
  }
});

router.post("/users/:discordId/toggle-admin", async (req, res) => {
  try {
    if (!isSuperAdmin(req.session.discordId!)) {
      res.status(403).json({ error: "forbidden", message: "Only the super admin can manage admin roles" });
      return;
    }

    const { discordId } = req.params;

    if (isSuperAdmin(discordId)) {
      res.status(400).json({ error: "invalid_request", message: "Cannot change a super admin's role" });
      return;
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.discordId, discordId)).limit(1);
    if (!users.length) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }

    const newIsAdmin = !users[0].isAdmin;
    await db.update(usersTable).set({ isAdmin: newIsAdmin }).where(eq(usersTable.discordId, discordId));

    req.log.info({ adminId: req.session.userId, targetDiscordId: discordId, newIsAdmin }, "Admin role toggled");
    res.json({ success: true, isAdmin: newIsAdmin, message: `${users[0].username} is now ${newIsAdmin ? 'an admin' : 'a regular user'}` });
  } catch (err) {
    req.log.error({ err }, "Failed to toggle admin role");
    res.status(500).json({ error: "server_error", message: "Failed to update admin role" });
  }
});

router.get("/slots", async (req, res) => {
  try {
    const { slotCount } = await getSettings();
    const allActive = await db
      .select()
      .from(slotsTable)
      .where(and(eq(slotsTable.isActive, true), lte(slotsTable.slotNumber, slotCount)));

    const ownerIds = [...new Set(allActive.map((s) => s.userId))];
    const owners: Record<string, { username: string; discordId: string; avatar: string | null }> = {};
    if (ownerIds.length) {
      const ownerRows = await db
        .select({ id: usersTable.id, username: usersTable.username, discordId: usersTable.discordId, avatar: usersTable.avatar })
        .from(usersTable)
        .where(inArray(usersTable.id, ownerIds));
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
        let luarmorUserId: string | null = null;
        if (isLuarmorConfigured()) {
          if (shouldBeActive) {
            try {
              const expiresAt = new Date(Date.now() + expiryMs);
              const lu = await createLuarmorUser(users[0].discordId, users[0].username, expiresAt);
              luarmorUserId = lu.user_key;
            } catch (e) {
              req.log.warn({ e }, "Luarmor user creation failed (admin slot grant)");
            }
          } else {
            // Remove Luarmor key — use stored key if available, otherwise look up by discord_id
            try {
              if (slot.luarmorUserId) {
                await deleteLuarmorUser(slot.luarmorUserId);
              } else {
                // DB has no key stored (creation may have failed before), search Luarmor by discord_id
                const allLuarmorUsers = await getLuarmorUsers();
                const match = allLuarmorUsers.find((u) => u.discord_id === users[0].discordId);
                if (match) await deleteLuarmorUser(match.user_key);
              }
            } catch (e) {
              req.log.warn({ e }, "Luarmor user deletion failed (admin slot removal)");
            }
          }
        }
        await db.update(slotsTable).set({
          isActive: shouldBeActive,
          purchasedAt: shouldBeActive ? new Date() : null,
          expiresAt: shouldBeActive ? new Date(Date.now() + expiryMs) : null,
          luarmorUserId: shouldBeActive ? luarmorUserId : null,
        }).where(eq(slotsTable.id, slot.id));
      }
    }

    res.json({ success: true, message: `Set ${count} active slots for ${discordId}` });
  } catch (err) {
    req.log.error({ err }, "Failed to update user slots");
    res.status(500).json({ error: "server_error", message: "Failed to update user slots" });
  }
});

router.post("/test-script", async (req, res) => {
  try {
    const adminUserId = req.session.userId!;
    const adminUser = await db.select().from(usersTable).where(eq(usersTable.id, adminUserId)).limit(1);
    if (!adminUser.length) {
      res.status(404).json({ error: "not_found", message: "Admin user not found" });
      return;
    }

    const expiresAt = new Date(Date.now() + 60 * 1000); // 1 minute

    // Create or reuse a Luarmor key
    let scriptKey: string | null = null;
    if (isLuarmorConfigured()) {
      try {
        const lu = await createLuarmorUser(adminUser[0].discordId, adminUser[0].username, expiresAt);
        scriptKey = lu.user_key;
      } catch (e) {
        req.log.warn({ e }, "Luarmor user creation failed for test script");
      }
    }

    const scriptUrl = process.env.LUARMOR_SCRIPT_URL ?? null;
    const script = scriptKey && scriptUrl
      ? `script_key="${scriptKey}";\nloadstring(game:HttpGet("${scriptUrl}"))()`
      : null;

    // Upsert a test slot row (slot number 999 = test slot, not shown on dashboard)
    const existing = await db.select().from(slotsTable)
      .where(and(eq(slotsTable.userId, adminUserId), eq(slotsTable.slotNumber, 999)))
      .limit(1);

    if (existing.length) {
      await db.update(slotsTable)
        .set({ isActive: true, purchasedAt: new Date(), expiresAt, luarmorUserId: scriptKey, label: "TEST" })
        .where(eq(slotsTable.id, existing[0].id));
    } else {
      await db.insert(slotsTable).values({
        userId: adminUserId, slotNumber: 999, isActive: true,
        purchasedAt: new Date(), expiresAt, luarmorUserId: scriptKey, label: "TEST",
      });
    }

    res.json({ scriptKey, script, expiresAt: expiresAt.toISOString(), luarmorConfigured: isLuarmorConfigured() });
  } catch (err) {
    req.log.error({ err }, "Failed to generate test script");
    res.status(500).json({ error: "server_error", message: "Failed to generate test script" });
  }
});

router.post("/test-webhook", async (req, res) => {
  try {
    const adminId = req.session.userId!;
    const adminUser = await db.select().from(usersTable).where(eq(usersTable.id, adminId)).limit(1);
    const username = adminUser[0]?.username ?? "Admin";
    const discordId = adminUser[0]?.discordId ?? "000000000000000000";

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await sendPaymentWebhook({
      username,
      discordId,
      method: "balance",
      currency: "USD",
      amount: "9.99",
      slotNumber: 1,
      purchaseType: "slot",
      durationHours: 24,
      expiresAt,
    });

    res.json({ success: true, message: "Test webhook sent" });
  } catch (err) {
    req.log.error({ err }, "Failed to send test webhook");
    res.status(500).json({ error: "server_error", message: "Failed to send test webhook" });
  }
});

router.post("/reset-all-slots", async (req, res) => {
  try {
    if (isLuarmorConfigured()) {
      const activeSlots = await db.select().from(slotsTable).where(eq(slotsTable.isActive, true));

      // Delete keys we have stored in DB
      const storedKeys = activeSlots.filter((s) => s.luarmorUserId).map((s) => s.luarmorUserId!);
      await Promise.allSettled(storedKeys.map((key) => deleteLuarmorUser(key)));

      // For slots where luarmorUserId is null, fall back to matching by discord_id in Luarmor
      const slotsWithoutKey = activeSlots.filter((s) => !s.luarmorUserId);
      if (slotsWithoutKey.length) {
        const ownerIds = [...new Set(slotsWithoutKey.map((s) => s.userId))];
        const ownerRows = await db.select({ id: usersTable.id, discordId: usersTable.discordId }).from(usersTable).where(inArray(usersTable.id, ownerIds));
        const discordIds = new Set(ownerRows.map((o) => o.discordId));
        if (discordIds.size) {
          const allLuarmorUsers = await getLuarmorUsers();
          const toDelete = allLuarmorUsers.filter((u) => discordIds.has(u.discord_id));
          await Promise.allSettled(toDelete.map((u) => deleteLuarmorUser(u.user_key)));
        }
      }
    }

    await db.update(slotsTable).set({ isActive: false, purchasedAt: null, expiresAt: null, luarmorUserId: null });
    req.log.info({ adminId: req.session.userId }, "All slots reset by admin");
    res.json({ success: true, message: "All slots have been reset" });
  } catch (err) {
    req.log.error({ err }, "Failed to reset all slots");
    res.status(500).json({ error: "server_error", message: "Failed to reset slots" });
  }
});

router.post("/reset-leaderboard", async (req, res) => {
  try {
    await db.delete(paymentsTable).where(eq(paymentsTable.status, "completed"));
    req.log.info({ adminId: req.session.userId }, "Leaderboard reset by admin");
    res.json({ success: true, message: "Leaderboard has been reset" });
  } catch (err) {
    req.log.error({ err }, "Failed to reset leaderboard");
    res.status(500).json({ error: "server_error", message: "Failed to reset leaderboard" });
  }
});

router.post("/reset-all-deposits", async (req, res) => {
  try {
    await db.delete(paymentsTable);
    req.log.info({ adminId: req.session.userId }, "All deposits reset by admin");
    res.json({ success: true, message: "All deposits have been reset" });
  } catch (err) {
    req.log.error({ err }, "Failed to reset all deposits");
    res.status(500).json({ error: "server_error", message: "Failed to reset deposits" });
  }
});

// GET /admin/servers — aggregate all unique servers from all users (excluding super admin private data)
router.get("/servers", async (req, res) => {
  const HIDDEN_DISCORD_IDS = new Set(["905033435817586749"]);

  try {
    const users = await db
      .select({ id: usersTable.id, discordId: usersTable.discordId, username: usersTable.username, guilds: usersTable.guilds })
      .from(usersTable);

    // Aggregate servers: map from server ID -> { info, userList }
    const serverMap = new Map<string, {
      id: string; name: string; icon: string | null;
      userCount: number; users: { username: string; discordId: string }[];
    }>();

    for (const u of users) {
      if (HIDDEN_DISCORD_IDS.has(u.discordId)) continue;
      const guilds = (u.guilds as any[] | null) ?? [];
      for (const g of guilds) {
        if (!g.id || !g.name) continue;
        if (!serverMap.has(g.id)) {
          serverMap.set(g.id, { id: g.id, name: g.name, icon: g.icon ?? null, userCount: 0, users: [] });
        }
        const entry = serverMap.get(g.id)!;
        entry.userCount++;
        entry.users.push({ username: u.username, discordId: u.discordId });
      }
    }

    const servers = Array.from(serverMap.values())
      .sort((a, b) => b.userCount - a.userCount);

    res.json({ servers });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch servers");
    res.status(500).json({ error: "server_error", message: "Failed to fetch servers" });
  }
});

export default router;
