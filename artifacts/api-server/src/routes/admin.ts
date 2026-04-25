import { Router } from "express";
import { db, slotsTable, usersTable, paymentsTable, couponsTable, bidsTable, reviewsTable } from "@workspace/db";
import { eq, sql, inArray, and, lte, desc, ne } from "drizzle-orm";
import { requireAdmin, isSuperAdmin } from "../middlewares/requireAdmin.js";
import { invalidateBanCache } from "../middlewares/requireAuth.js";
import { generateSlotToken, verifySlotToken } from "../lib/slotToken.js";
import { getSettings, setSetting } from "../lib/settings.js";
import { runAutoFulfillment } from "../lib/fulfillment.js";
import { isLuarmorConfigured, createLuarmorUser, deleteLuarmorUser, getLuarmorUsers, pauseLuarmorUser, unpauseLuarmorUser } from "../lib/luarmor.js";
import { sendPaymentWebhook, sendDiscordDM, addGuildRole, sendReviewDM } from "../lib/discord.js";
import { activateSlotShared } from "../lib/slotActivation.js";
import { runPaymentPoller } from "../lib/paymentPoller.js";

const router = Router();

router.use(requireAdmin);

// Quick Luarmor connectivity test — call from browser or curl to diagnose auth issues
router.get("/luarmor/test", async (req, res) => {
  // First fetch the actual outbound IP this server is using
  let outboundIp = "unknown";
  try {
    const ipRes = await fetch("https://api.ipify.org?format=json");
    const ipData = await ipRes.json() as { ip: string };
    outboundIp = ipData.ip;
  } catch { /* ignore */ }

  try {
    if (!isLuarmorConfigured()) {
      return res.status(400).json({ ok: false, outboundIp, error: "LUARMOR_API_KEY or LUARMOR_PROJECT_ID not set in env" });
    }
    const users = await getLuarmorUsers();
    return res.json({ ok: true, outboundIp, userCount: users.length, message: "Luarmor connection successful" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, outboundIp, error: msg });
  }
});

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
    const { slotCount, pricePerDay, slotDurationHours, hourlyPricingEnabled, pricePerHour, minHours, paymentsEnabled } = req.body;

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

    if (paymentsEnabled !== undefined) {
      await setSetting("paymentsEnabled", paymentsEnabled ? "true" : "false");
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
        isBanned: u.isBanned,
        activeSlots: userSlots.filter((s) => s.isActive).length,
        totalSlots: slotCount,
        guilds: (u.guilds as any[] | null) ?? [],
        balance: u.balance ?? "0.00",
      };
    });

    res.json({ users: result });
  } catch (err) {
    req.log.error({ err }, "Failed to get admin users");
    res.status(500).json({ error: "server_error", message: "Failed to get users" });
  }
});

router.post("/users/:discordId/add-balance", async (req, res) => {
  try {
    const { discordId } = req.params;
    const { amount } = req.body as { amount?: number };

    if (amount === undefined || typeof amount !== "number" || isNaN(amount) || !isFinite(amount)) {
      res.status(400).json({ error: "invalid_amount", message: "Amount is required and must be a number" });
      return;
    }

    // Only super admins may deduct balance — regular admins can only add
    if (amount < 0 && !isSuperAdmin(req.session.discordId!)) {
      res.status(403).json({ error: "forbidden", message: "Only super admins can deduct balance" });
      return;
    }

    // Hard cap per adjustment: $10,000 add / $10,000 deduct
    if (amount > 10000 || amount < -10000) {
      res.status(400).json({ error: "invalid_amount", message: "Amount must be between -$10,000 and $10,000 per adjustment" });
      return;
    }

    const users = await db.select().from(usersTable).where(eq(usersTable.discordId, discordId)).limit(1);
    if (!users.length) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }

    const currentBalance = parseFloat(users[0].balance ?? "0");
    const newBalance = Math.max(0, currentBalance + amount).toFixed(2);

    await db.update(usersTable)
      .set({ balance: newBalance, updatedAt: new Date() })
      .where(eq(usersTable.discordId, discordId));

    req.log.info({ adminId: req.session.userId, adminDiscordId: req.session.discordId, targetDiscordId: discordId, amount, newBalance }, "Admin adjusted user balance");
    res.json({ success: true, newBalance, message: `Balance updated to $${newBalance} for ${users[0].username}` });
  } catch (err) {
    req.log.error({ err }, "Failed to adjust user balance");
    res.status(500).json({ error: "server_error", message: "Failed to update balance" });
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
        isPaused: active?.isPaused ?? false,
        pausedAt: active?.pausedAt?.toISOString() ?? null,
        tokenStatus: active
          ? verifySlotToken(active.purchaseToken, active.userId, active.slotNumber, active.purchasedAt)
          : null,
      };
    });

    res.json({ slots });
  } catch (err) {
    req.log.error({ err }, "Failed to get admin slots");
    res.status(500).json({ error: "server_error", message: "Failed to get slots" });
  }
});

router.post("/slots/:slotNumber/toggle-pause", async (req, res) => {
  try {
    if (!isSuperAdmin(req.session.discordId!)) {
      res.status(403).json({ error: "forbidden", message: "Only super admins can pause/unpause slots" });
      return;
    }

    const slotNumber = parseInt(req.params.slotNumber as string, 10);
    if (isNaN(slotNumber) || slotNumber < 1) {
      res.status(400).json({ error: "invalid_slot", message: "Invalid slot number" });
      return;
    }

    const slots = await db
      .select()
      .from(slotsTable)
      .where(and(eq(slotsTable.slotNumber, slotNumber), eq(slotsTable.isActive, true)))
      .limit(1);

    if (!slots.length) {
      res.status(404).json({ error: "not_found", message: "No active slot found at that number" });
      return;
    }

    const slot = slots[0];
    const now = new Date();

    if (!slot.isPaused) {
      // Pause: require a reason
      const { reason } = req.body as { reason?: string };
      if (!reason || !reason.trim()) {
        res.status(400).json({ error: "reason_required", message: "A reason is required when pausing a slot" });
        return;
      }

      // Disable Luarmor key
      if (isLuarmorConfigured() && slot.luarmorUserId) {
        try {
          await pauseLuarmorUser(slot.luarmorUserId);
        } catch (e) {
          req.log.warn({ e }, "Luarmor pause failed");
        }
      }

      await db
        .update(slotsTable)
        .set({ isPaused: true, pausedAt: now })
        .where(eq(slotsTable.id, slot.id));

      // DM the user
      const userRows = await db.select({ discordId: usersTable.discordId, username: usersTable.username })
        .from(usersTable).where(eq(usersTable.id, slot.userId)).limit(1);
      if (userRows.length) {
        sendDiscordDM(
          userRows[0].discordId,
          `⏸️ **Your slot #${slotNumber} has been paused.**\n📋 **Reason:** ${reason.trim()}\n\nYour remaining time is frozen and will resume when your slot is unpaused. Contact support if you have questions.`
        ).catch(() => {});
      }

      req.log.info({ adminDiscordId: req.session.discordId, slotNumber, reason: reason.trim() }, "Slot paused");
      res.json({ success: true, isPaused: true, message: `Slot #${slotNumber} paused` });
    } else {
      // Unpause: extend expiresAt by the time it was paused, re-enable Luarmor key
      const pausedMs = now.getTime() - (slot.pausedAt?.getTime() ?? now.getTime());
      const currentExpiry = slot.expiresAt ?? now;
      const newExpiresAt = new Date(currentExpiry.getTime() + pausedMs);

      let finalLuarmorKey = slot.luarmorUserId;

      if (isLuarmorConfigured()) {
        const userRows = await db.select().from(usersTable).where(eq(usersTable.id, slot.userId)).limit(1);
        const user = userRows[0];

        if (finalLuarmorKey) {
          try {
            await unpauseLuarmorUser(finalLuarmorKey, newExpiresAt);
          } catch (e) {
            // Luarmor may have auto-deleted the user because auth_expire was set to the past.
            // Create a fresh Luarmor user and update the stored key.
            req.log.warn({ e, userKey: finalLuarmorKey }, "Luarmor unpause failed — recreating user");
            if (user) {
              try {
                const newLuarmor = await createLuarmorUser(user.discordId, user.username, newExpiresAt);
                finalLuarmorKey = newLuarmor.user_key;
              } catch (e2) {
                req.log.warn({ e2 }, "Luarmor user recreation also failed");
              }
            }
          }
        } else if (user) {
          // No key stored — create one from scratch
          try {
            const newLuarmor = await createLuarmorUser(user.discordId, user.username, newExpiresAt);
            finalLuarmorKey = newLuarmor.user_key;
          } catch (e) {
            req.log.warn({ e }, "Luarmor user creation on unpause failed");
          }
        }
      }

      await db
        .update(slotsTable)
        .set({ isPaused: false, pausedAt: null, expiresAt: newExpiresAt, luarmorUserId: finalLuarmorKey } as any)
        .where(eq(slotsTable.id, slot.id));

      // DM the user on unpause
      const unpauseUserRows = await db.select({ discordId: usersTable.discordId, username: usersTable.username })
        .from(usersTable).where(eq(usersTable.id, slot.userId)).limit(1);
      if (unpauseUserRows.length) {
        const ts = Math.floor(newExpiresAt.getTime() / 1000);
        sendDiscordDM(
          unpauseUserRows[0].discordId,
          `▶️ **Your slot #${slotNumber} has been unpaused.**\n⏰ Your time has been restored — new expiry: <t:${ts}:F>.`
        ).catch(() => {});
      }

      req.log.info({ adminDiscordId: req.session.discordId, slotNumber, newExpiresAt, luarmorKeyRecreated: finalLuarmorKey !== slot.luarmorUserId }, "Slot unpaused");
      res.json({ success: true, isPaused: false, message: `Slot #${slotNumber} unpaused — expiry extended by ${Math.round(pausedMs / 60000)} min` });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to toggle slot pause");
    res.status(500).json({ error: "server_error", message: "Failed to toggle pause" });
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

    // Find slot numbers currently active for OTHER users (busy slots)
    const otherActiveSlots = await db.select({ slotNumber: slotsTable.slotNumber })
      .from(slotsTable)
      .where(and(eq(slotsTable.isActive, true), ne(slotsTable.userId, userId)));
    const busySlotNumbers = new Set(otherActiveSlots.map((s) => s.slotNumber));

    // Find available slot numbers (not occupied by another user), in order
    const availableSlotNumbers: number[] = [];
    for (let i = 1; i <= slotCount; i++) {
      if (!busySlotNumbers.has(i)) availableSlotNumbers.push(i);
    }

    const count = Math.min(activeSlotCount, availableSlotNumbers.length);
    // Only activate the first `count` available slot numbers
    const slotsToActivate = new Set(availableSlotNumbers.slice(0, count));

    // Ensure the user has a row for every slot number we need to activate
    const existingSlots = await db.select().from(slotsTable).where(eq(slotsTable.userId, userId));
    const existingNumbers = new Set(existingSlots.map((s) => s.slotNumber));
    for (const slotNum of slotsToActivate) {
      if (!existingNumbers.has(slotNum)) {
        await db.insert(slotsTable).values({ userId, slotNumber: slotNum, isActive: false });
      }
    }

    const slots = await db.select().from(slotsTable).where(eq(slotsTable.userId, userId));

    for (const slot of slots) {
      if (slot.slotNumber > slotCount) continue;
      const shouldBeActive = slotsToActivate.has(slot.slotNumber);
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
        const purchasedAt = shouldBeActive ? new Date() : null;
        await db.update(slotsTable).set({
          isActive: shouldBeActive,
          purchasedAt,
          expiresAt: shouldBeActive ? new Date(Date.now() + expiryMs) : null,
          luarmorUserId: shouldBeActive ? luarmorUserId : null,
          purchaseToken: shouldBeActive && purchasedAt
            ? generateSlotToken(userId, slot.slotNumber, purchasedAt)
            : null,
        }).where(eq(slotsTable.id, slot.id));
      }
    }

    res.json({ success: true, message: `Set ${count} active slots for ${discordId}` });

    // Immediately check if any queued bids/preorders can be fulfilled
    runAutoFulfillment().catch((err) => req.log.warn({ err }, "Auto-fulfillment after slot change failed"));
  } catch (err) {
    req.log.error({ err }, "Failed to update user slots");
    res.status(500).json({ error: "server_error", message: "Failed to update user slots" });
  }
});

router.post("/test-dm", async (req, res) => {
  const adminUserId = req.session.userId!;
  const adminUser = await db.select().from(usersTable).where(eq(usersTable.id, adminUserId)).limit(1);
  if (!adminUser.length) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const discordId = adminUser[0].discordId;
  await sendDiscordDM(discordId, "✅ Test DM from Exe Joiner bot — DMs are working!");
  res.json({ success: true, discordId });
});

router.post("/send-review-dm", async (req, res) => {
  try {
    const { discordId } = req.body as { discordId?: string };
    if (!discordId || typeof discordId !== "string") {
      res.status(400).json({ error: "discordId is required" });
      return;
    }
    await sendReviewDM(discordId);
    res.json({ success: true, discordId });
  } catch (err) {
    req.log.error({ err }, "Admin: send-review-dm failed");
    res.status(500).json({ error: "internal_error" });
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

// POST /api/admin/payments/:id/verify — manually verify and complete a pending payment
router.post("/payments/:id/verify", async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id)).limit(1);
    if (!rows.length) {
      res.status(404).json({ error: "not_found", message: "Payment not found" });
      return;
    }
    const payment = rows[0];
    if (payment.status === "completed") {
      res.json({ success: true, message: "Already completed" });
      return;
    }

    const isStripe = payment.method?.includes("stripe");
    const isCrypto = payment.method?.includes("crypto") || payment.method === "crypto";
    const isBalanceDeposit = payment.method?.startsWith("balance-deposit");

    // ── Stripe verification ───────────────────────────────────────────────
    if (isStripe) {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        res.status(503).json({ error: "payment_unavailable", message: "Stripe not configured" });
        return;
      }
      if (!payment.stripeSessionId) {
        res.status(400).json({ error: "no_ref", message: "No Stripe session ID on record" });
        return;
      }
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(stripeKey);
      const session = await stripe.checkout.sessions.retrieve(payment.stripeSessionId);
      if (session.payment_status !== "paid") {
        res.status(402).json({ error: "not_paid", message: `Stripe session status: ${session.payment_status}` });
        return;
      }

      if (isBalanceDeposit) {
        // Credit balance
        const amount = parseFloat(payment.amount ?? "0");
        await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, id));
        await db.update(usersTable)
          .set({ balance: sql`${usersTable.balance} + ${amount.toFixed(2)}::numeric`, updatedAt: new Date() })
          .where(eq(usersTable.id, payment.userId));
        const userRows = await db.select().from(usersTable).where(eq(usersTable.id, payment.userId)).limit(1);
        if (userRows.length) {
          await sendPaymentWebhook({
            username: userRows[0].username,
            discordId: userRows[0].discordId,
            method: payment.method,
            currency: "USD",
            amount: amount.toFixed(2),
            purchaseType: "balance_deposit",
          });
        }
        req.log.info({ id, amount }, "Admin manually completed balance-deposit-stripe");
        res.json({ success: true, message: `Balance of $${amount.toFixed(2)} credited` });
        return;
      }

      // Slot stripe payment — activate slot inline
      const { slotDurationHours } = await getSettings();
      const hours = payment.derivationIndex ?? slotDurationHours;
      const expiryMs = hours * 60 * 60 * 1000;
      const expiresAt = new Date(Date.now() + expiryMs);
      await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, id));
      const userRows2 = await db.select().from(usersTable).where(eq(usersTable.id, payment.userId)).limit(1);
      let luarmorKey2: string | null = null;
      if (isLuarmorConfigured() && userRows2.length) {
        try { const lu = await createLuarmorUser(userRows2[0].discordId, userRows2[0].username, expiresAt); luarmorKey2 = lu.user_key; } catch {}
      }
      const existing = await db.select().from(slotsTable).where(and(eq(slotsTable.userId, payment.userId), eq(slotsTable.slotNumber, payment.slotNumber))).limit(1);
      const purchasedAt = new Date();
      const slotData = { isActive: true, purchasedAt, expiresAt, purchaseToken: generateSlotToken(payment.userId, payment.slotNumber, purchasedAt), ...(luarmorKey2 ? { luarmorUserId: luarmorKey2 } : {}) };
      if (existing.length) {
        await db.update(slotsTable).set(slotData).where(and(eq(slotsTable.userId, payment.userId), eq(slotsTable.slotNumber, payment.slotNumber)));
      } else {
        await db.insert(slotsTable).values({ userId: payment.userId, slotNumber: payment.slotNumber, ...slotData });
      }
      if (userRows2.length) {
        await sendPaymentWebhook({
          username: userRows2[0].username,
          discordId: userRows2[0].discordId,
          method: payment.method,
          currency: "USD",
          amount: payment.amount,
          slotNumber: payment.slotNumber,
          purchaseType: "slot",
          durationHours: hours,
          expiresAt,
        });
        const ts2 = Math.floor(expiresAt.getTime() / 1000);
        const keyLine2 = luarmorKey2 ? `\n🔑 **Your script key:** \`${luarmorKey2}\`` : `\n🔑 Get your script key from the dashboard.`;
        sendDiscordDM(userRows2[0].discordId, `✅ **Slot #${payment.slotNumber} is now active!**${keyLine2}\n⏰ Expires <t:${ts2}:F>.`).catch(() => {});
      }
      req.log.info({ id }, "Admin manually completed stripe slot payment");
      res.json({ success: true, message: `Slot #${payment.slotNumber} activated` });
      return;
    }

    // ── NOWPayments crypto verification ───────────────────────────────────
    if (isCrypto) {
      const apiKey = process.env.NOWPAYMENTS_API_KEY;
      if (!apiKey) {
        res.status(503).json({ error: "payment_unavailable", message: "NOWPayments not configured" });
        return;
      }
      if (!payment.txHash) {
        res.status(400).json({ error: "no_ref", message: "No NOWPayments payment ID on record" });
        return;
      }
      const npRes = await fetch(`https://api.nowpayments.io/v1/payment/${payment.txHash}`, {
        headers: { "x-api-key": apiKey },
      });
      if (!npRes.ok) {
        res.status(502).json({ error: "nowpayments_error", message: `NOWPayments returned ${npRes.status}` });
        return;
      }
      const npData = await npRes.json() as { payment_status: string };
      const confirmed = npData.payment_status === "finished" || npData.payment_status === "confirmed";
      if (!confirmed) {
        res.status(402).json({ error: "not_confirmed", message: `NOWPayments status: ${npData.payment_status}` });
        return;
      }

      if (isBalanceDeposit) {
        const amount = parseFloat(payment.amount ?? "0");
        await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, id));
        await db.update(usersTable)
          .set({ balance: sql`${usersTable.balance} + ${amount.toFixed(2)}::numeric`, updatedAt: new Date() })
          .where(eq(usersTable.id, payment.userId));
        const userRows = await db.select().from(usersTable).where(eq(usersTable.id, payment.userId)).limit(1);
        if (userRows.length) {
          await sendPaymentWebhook({
            username: userRows[0].username,
            discordId: userRows[0].discordId,
            method: payment.method,
            currency: payment.currency,
            amount: amount.toFixed(2),
            purchaseType: "balance_deposit",
          });
        }
        req.log.info({ id, amount }, "Admin manually completed balance-deposit-crypto");
        res.json({ success: true, message: `Balance of $${amount.toFixed(2)} credited` });
        return;
      }

      // Crypto slot payment
      const { slotDurationHours } = await getSettings();
      const hours = payment.derivationIndex ?? slotDurationHours;
      const expiryMs = hours * 60 * 60 * 1000;
      const expiresAt = new Date(Date.now() + expiryMs);
      await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, id));
      const userRows3 = await db.select().from(usersTable).where(eq(usersTable.id, payment.userId)).limit(1);
      let luarmorKey3: string | null = null;
      if (isLuarmorConfigured() && userRows3.length) {
        try { const lu = await createLuarmorUser(userRows3[0].discordId, userRows3[0].username, expiresAt); luarmorKey3 = lu.user_key; } catch {}
      }
      const existing2 = await db.select().from(slotsTable).where(and(eq(slotsTable.userId, payment.userId), eq(slotsTable.slotNumber, payment.slotNumber))).limit(1);
      const purchasedAt2 = new Date();
      const slotData2 = { isActive: true, purchasedAt: purchasedAt2, expiresAt, purchaseToken: generateSlotToken(payment.userId, payment.slotNumber, purchasedAt2), ...(luarmorKey3 ? { luarmorUserId: luarmorKey3 } : {}) };
      if (existing2.length) {
        await db.update(slotsTable).set(slotData2).where(and(eq(slotsTable.userId, payment.userId), eq(slotsTable.slotNumber, payment.slotNumber)));
      } else {
        await db.insert(slotsTable).values({ userId: payment.userId, slotNumber: payment.slotNumber, ...slotData2 });
      }
      if (userRows3.length) {
        await sendPaymentWebhook({
          username: userRows3[0].username,
          discordId: userRows3[0].discordId,
          method: payment.method,
          currency: payment.currency,
          amount: payment.amount,
          slotNumber: payment.slotNumber,
          purchaseType: "slot",
          durationHours: hours,
          expiresAt,
        });
        const ts3 = Math.floor(expiresAt.getTime() / 1000);
        const keyLine3 = luarmorKey3 ? `\n🔑 **Your script key:** \`${luarmorKey3}\`` : `\n🔑 Get your script key from the dashboard.`;
        sendDiscordDM(userRows3[0].discordId, `✅ **Slot #${payment.slotNumber} is now active!**${keyLine3}\n⏰ Expires <t:${ts3}:F>.`).catch(() => {});
      }
      req.log.info({ id }, "Admin manually completed crypto slot payment");
      res.json({ success: true, message: `Slot #${payment.slotNumber} activated` });
      return;
    }

    res.status(400).json({ error: "unsupported_method", message: `Cannot verify method: ${payment.method}` });
  } catch (err) {
    req.log.error({ err }, "Admin payment verify failed");
    res.status(500).json({ error: "server_error", message: err instanceof Error ? err.message : "Unknown error" });
  }
});

router.get("/all-payments", async (req, res) => {
  try {
    const payments = await db
      .select()
      .from(paymentsTable)
      .orderBy(desc(paymentsTable.createdAt))
      .limit(500);

    const userIds = [...new Set(payments.map(p => p.userId))];
    const userMap: Record<string, { username: string; discordId: string; avatar: string | null }> = {};
    if (userIds.length) {
      const rows = await db
        .select({ id: usersTable.id, username: usersTable.username, discordId: usersTable.discordId, avatar: usersTable.avatar })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds));
      for (const u of rows) userMap[u.id] = { username: u.username, discordId: u.discordId, avatar: u.avatar };
    }

    const result = payments.map(p => ({
      id: p.id,
      username: userMap[p.userId]?.username ?? "Unknown",
      discordId: userMap[p.userId]?.discordId ?? "",
      avatar: userMap[p.userId]?.avatar ?? null,
      status: p.status,
      method: p.method,
      currency: p.currency,
      amount: p.amount,
      usdAmount: p.usdAmount,
      slotNumber: p.slotNumber,
      address: p.address,
      txHash: p.txHash,
      stripeSessionId: p.stripeSessionId,
      expiresAt: p.expiresAt?.toISOString() ?? null,
      couponId: p.couponId,
      createdAt: p.createdAt?.toISOString() ?? null,
      updatedAt: p.updatedAt?.toISOString() ?? null,
      purchaseType: p.method?.startsWith("preorder") ? "preorder" : p.method?.startsWith("balance-deposit") ? "balance_deposit" : "slot",
    }));

    res.json({ payments: result, total: result.length });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch all payments");
    res.status(500).json({ error: "server_error", message: "Failed to fetch payments" });
  }
});

router.get("/logs", async (req, res) => {
  try {
    const payments = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.status, "completed"))
      .orderBy(desc(paymentsTable.updatedAt))
      .limit(200);

    const userIds = [...new Set(payments.map(p => p.userId))];
    const userMap: Record<string, { username: string; discordId: string; avatar: string | null }> = {};
    if (userIds.length) {
      const rows = await db.select({ id: usersTable.id, username: usersTable.username, discordId: usersTable.discordId, avatar: usersTable.avatar })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds));
      for (const u of rows) userMap[u.id] = { username: u.username, discordId: u.discordId, avatar: u.avatar };
    }

    const logs = payments.map(p => ({
      id: p.id,
      username: userMap[p.userId]?.username ?? "Unknown",
      discordId: userMap[p.userId]?.discordId ?? "",
      avatar: userMap[p.userId]?.avatar ?? null,
      method: p.method,
      currency: p.currency,
      amount: p.amount,
      slotNumber: p.slotNumber,
      hours: p.derivationIndex ?? null,
      purchaseType: p.method?.startsWith("preorder") ? "preorder" : p.method?.startsWith("balance-deposit") ? "balance_deposit" : "slot",
      createdAt: p.createdAt?.toISOString() ?? null,
      completedAt: p.updatedAt?.toISOString() ?? null,
    }));

    res.json({ logs });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin logs");
    res.status(500).json({ error: "server_error", message: "Failed to fetch logs" });
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

// GET /admin/transactions — revenue summary and per-transaction detail
router.get("/transactions", async (req, res) => {
  try {
    const [payments, pendingStripeRows] = await Promise.all([
      db.select().from(paymentsTable).where(eq(paymentsTable.status, "completed")).orderBy(desc(paymentsTable.updatedAt)).limit(1000),
      db.select({ usdAmount: paymentsTable.usdAmount, amount: paymentsTable.amount })
        .from(paymentsTable)
        .where(and(eq(paymentsTable.status, "pending"), ne(paymentsTable.method, "crypto"))),
    ]);
    const pendingStripeTotal = parseFloat(
      pendingStripeRows.reduce((sum, p) => sum + parseFloat(p.usdAmount ?? p.amount ?? "0"), 0).toFixed(2)
    );

    // Revenue = real sales only (exclude balance-funded purchases and deposits)
    const revenue = payments.filter(p =>
      p.method !== "balance" &&
      p.method !== "preorder-balance" &&
      p.method !== "balance-deposit-crypto" &&
      p.method !== "balance-deposit-stripe"
    );

    const userIds = [...new Set(revenue.map(p => p.userId))];
    const userMap: Record<string, { username: string; discordId: string; avatar: string | null }> = {};
    if (userIds.length) {
      const rows = await db
        .select({ id: usersTable.id, username: usersTable.username, discordId: usersTable.discordId, avatar: usersTable.avatar })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds));
      for (const u of rows) userMap[u.id] = { username: u.username, discordId: u.discordId, avatar: u.avatar };
    }

    function getUsdValue(p: typeof revenue[0]): number {
      if (p.usdAmount) return parseFloat(p.usdAmount);
      // For any payment method, fall back to the stored amount as USD
      // (crypto payments store the USD charge amount in usdAmount, but older records may not)
      return parseFloat(p.amount ?? "0");
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    function getPeriodStats(since: Date) {
      const filtered = revenue.filter(p => new Date(p.updatedAt) >= since);
      let stripeTotal = 0, cryptoTotal = 0, stripeCount = 0, cryptoCount = 0;
      for (const p of filtered) {
        const usd = getUsdValue(p);
        if (p.method?.includes("stripe")) { stripeTotal += usd; stripeCount++; }
        else { cryptoTotal += usd; cryptoCount++; }
      }
      return {
        total: parseFloat((stripeTotal + cryptoTotal).toFixed(2)),
        stripe: parseFloat(stripeTotal.toFixed(2)),
        crypto: parseFloat(cryptoTotal.toFixed(2)),
        stripeCount,
        cryptoCount,
        count: stripeCount + cryptoCount,
      };
    }

    const transactions = revenue.map(p => ({
      id: p.id,
      username: userMap[p.userId]?.username ?? "Unknown",
      discordId: userMap[p.userId]?.discordId ?? "",
      avatar: userMap[p.userId]?.avatar ?? null,
      method: p.method,
      isStripe: p.method?.includes("stripe") ?? false,
      currency: p.currency,
      rawAmount: p.amount,
      usdAmount: getUsdValue(p).toFixed(2),
      purchaseType: p.method?.startsWith("preorder") ? "preorder" : "slot",
      slotNumber: p.slotNumber,
      completedAt: p.updatedAt?.toISOString() ?? null,
    }));

    res.json({
      summary: {
        today: getPeriodStats(startOfToday),
        week: getPeriodStats(startOfWeek),
        month: getPeriodStats(startOfMonth),
        allTime: getPeriodStats(new Date(0)),
        pendingStripeTotal,
      },
      transactions,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin transactions");
    res.status(500).json({ error: "server_error", message: "Failed to fetch transactions" });
  }
});

// POST /admin/users/:discordId/ban — ban or unban a user
router.post("/users/:discordId/ban", async (req, res) => {
  try {
    const { discordId } = req.params;
    if (isSuperAdmin(discordId)) {
      res.status(400).json({ error: "invalid_request", message: "Cannot ban the super admin" });
      return;
    }
    const users = await db.select().from(usersTable).where(eq(usersTable.discordId, discordId)).limit(1);
    if (!users.length) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }
    const newBanned = !users[0].isBanned;
    await db.update(usersTable).set({
      isBanned: newBanned,
      bannedAt: newBanned ? new Date() : null,
      updatedAt: new Date(),
    } as any).where(eq(usersTable.discordId, discordId));
    // Immediately purge from ban cache so the ban/unban takes effect on the user's
    // very next request rather than waiting for the 30-second cache TTL to expire.
    invalidateBanCache(users[0].id);
    req.log.info({ adminId: req.session.userId, targetDiscordId: discordId, isBanned: newBanned }, "User ban toggled");
    res.json({ success: true, isBanned: newBanned, message: `${users[0].username} has been ${newBanned ? "banned" : "unbanned"}` });
  } catch (err) {
    req.log.error({ err }, "Failed to toggle ban");
    res.status(500).json({ error: "server_error", message: "Failed to update ban status" });
  }
});

// GET /admin/coupons — list all coupons
router.get("/coupons", async (req, res) => {
  try {
    const coupons = await db.select().from(couponsTable).orderBy(desc(couponsTable.createdAt));
    res.json({ coupons });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch coupons");
    res.status(500).json({ error: "server_error", message: "Failed to fetch coupons" });
  }
});

// POST /admin/coupons — create a coupon
router.post("/coupons", async (req, res) => {
  try {
    const { code, discountType, discountValue, maxUses, expiresAt } = req.body as {
      code?: string;
      discountType?: string;
      discountValue?: number;
      maxUses?: number | null;
      expiresAt?: string | null;
    };

    if (!code || typeof code !== "string" || !code.trim()) {
      res.status(400).json({ error: "invalid_code", message: "Code is required" });
      return;
    }
    if (!discountType || !["percent", "fixed"].includes(discountType)) {
      res.status(400).json({ error: "invalid_type", message: "discountType must be 'percent' or 'fixed'" });
      return;
    }
    if (!discountValue || typeof discountValue !== "number" || discountValue <= 0) {
      res.status(400).json({ error: "invalid_value", message: "discountValue must be a positive number" });
      return;
    }
    if (discountType === "percent" && discountValue > 100) {
      res.status(400).json({ error: "invalid_value", message: "Percent discount cannot exceed 100" });
      return;
    }

    const normalizedCode = code.toUpperCase().trim();
    const existing = await db.select().from(couponsTable).where(eq(couponsTable.code, normalizedCode)).limit(1);
    if (existing.length) {
      res.status(409).json({ error: "duplicate_code", message: "A coupon with that code already exists" });
      return;
    }

    const [created] = await db.insert(couponsTable).values({
      code: normalizedCode,
      discountType,
      discountValue: discountValue.toFixed(2),
      maxUses: maxUses ?? null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      isActive: true,
    }).returning();

    res.json({ success: true, coupon: created });
  } catch (err) {
    req.log.error({ err }, "Failed to create coupon");
    res.status(500).json({ error: "server_error", message: "Failed to create coupon" });
  }
});

// DELETE /admin/coupons/:id — delete a coupon
router.delete("/coupons/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "invalid_id", message: "Invalid coupon ID" });
      return;
    }
    const existing = await db.select().from(couponsTable).where(eq(couponsTable.id, id)).limit(1);
    if (!existing.length) {
      res.status(404).json({ error: "not_found", message: "Coupon not found" });
      return;
    }
    await db.delete(couponsTable).where(eq(couponsTable.id, id));
    res.json({ success: true, message: "Coupon deleted" });
  } catch (err) {
    req.log.error({ err }, "Failed to delete coupon");
    res.status(500).json({ error: "server_error", message: "Failed to delete coupon" });
  }
});

// PATCH /admin/coupons/:id/toggle — enable or disable a coupon
router.patch("/coupons/:id/toggle", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "invalid_id", message: "Invalid coupon ID" });
      return;
    }
    const existing = await db.select().from(couponsTable).where(eq(couponsTable.id, id)).limit(1);
    if (!existing.length) {
      res.status(404).json({ error: "not_found", message: "Coupon not found" });
      return;
    }
    const newActive = !existing[0].isActive;
    await db.update(couponsTable).set({ isActive: newActive }).where(eq(couponsTable.id, id));
    res.json({ success: true, isActive: newActive });
  } catch (err) {
    req.log.error({ err }, "Failed to toggle coupon");
    res.status(500).json({ error: "server_error", message: "Failed to toggle coupon" });
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

// POST /api/admin/bids/fulfill — activate slot for top bidder, refund everyone else
router.post("/bids/fulfill", async (req, res) => {
  try {
    const allBids = await db
      .select()
      .from(bidsTable)
      .where(eq(bidsTable.status, "active"))
      .orderBy(desc(bidsTable.amount), bidsTable.createdAt);

    if (!allBids.length) {
      res.status(400).json({ error: "no_bids", message: "No active bids to fulfill" });
      return;
    }

    const winner = allBids[0];
    const losers = allBids.slice(1);

    // Refund all losers
    for (const bid of losers) {
      const refund = parseFloat(bid.amount);
      await db.update(usersTable)
        .set({ balance: sql`${usersTable.balance} + ${refund.toFixed(2)}::numeric`, updatedAt: new Date() })
        .where(eq(usersTable.id, bid.userId));
    }

    // The winner's bid amount stays spent — it's the payment for their slot
    // Activate slot for winner using same logic as the normal slot grant
    const winnerUsers = await db.select().from(usersTable).where(eq(usersTable.id, winner.userId)).limit(1);
    if (!winnerUsers.length) {
      res.status(404).json({ error: "not_found", message: "Winning user not found" });
      return;
    }

    const winnerUser = winnerUsers[0];
    const { slotCount } = await getSettings();
    const bidHours = 1;
    const expiryMs = bidHours * 60 * 60 * 1000;

    const otherActiveSlots = await db.select({ slotNumber: slotsTable.slotNumber })
      .from(slotsTable)
      .where(and(eq(slotsTable.isActive, true), ne(slotsTable.userId, winner.userId)));
    const busySlotNumbers = new Set(otherActiveSlots.map((s) => s.slotNumber));

    const availableSlotNumbers: number[] = [];
    for (let i = 1; i <= slotCount; i++) {
      if (!busySlotNumbers.has(i)) availableSlotNumbers.push(i);
    }

    if (!availableSlotNumbers.length) {
      res.status(409).json({ error: "no_slots", message: "No available slots right now" });
      return;
    }

    const slotNum = availableSlotNumbers[0];
    const existingSlot = await db.select().from(slotsTable)
      .where(and(eq(slotsTable.userId, winner.userId), eq(slotsTable.slotNumber, slotNum)))
      .limit(1);

    if (!existingSlot.length) {
      await db.insert(slotsTable).values({ userId: winner.userId, slotNumber: slotNum, isActive: false });
    }

    const slotRow = await db.select().from(slotsTable)
      .where(and(eq(slotsTable.userId, winner.userId), eq(slotsTable.slotNumber, slotNum)))
      .limit(1);

    const expiresAt = new Date(Date.now() + expiryMs);
    const bidPurchasedAt = new Date();
    let luarmorKey: string | null = null;
    if (isLuarmorConfigured()) {
      try {
        const keyData = await createLuarmorUser(winnerUser.discordId, winnerUser.username, expiresAt);
        luarmorKey = keyData?.user_key ?? null;
      } catch (e) {
        req.log.warn({ e }, "Luarmor user creation failed (bid fulfill)");
      }
    }

    await db.update(slotsTable).set({
      isActive: true,
      purchasedAt: bidPurchasedAt,
      expiresAt,
      luarmorUserId: luarmorKey ?? slotRow[0]?.luarmorUserId ?? null,
      purchaseToken: generateSlotToken(winner.userId, slotNum, bidPurchasedAt),
      notified24h: false,
      notified1h: false,
      notified10m: false,
    }).where(and(eq(slotsTable.userId, winner.userId), eq(slotsTable.slotNumber, slotNum)));

    const buyerRoleId = process.env.DISCORD_SLOT_HOLDER_ROLE_ID ?? "1475135841994014761";
    addGuildRole(winnerUser.discordId, buyerRoleId).catch(() => {});

    // Record the payment
    await db.insert(paymentsTable).values({
      userId: winner.userId,
      slotNumber: slotNum,
      method: "bid-balance",
      status: "completed",
      amount: winner.amount,
      usdAmount: winner.amount,
      currency: "USD",
      derivationIndex: 1,
    });

    // Delete ALL bids
    await db.delete(bidsTable);

    try {
      await sendPaymentWebhook({
        username: winnerUser.username,
        discordId: winnerUser.discordId,
        method: "balance",
        currency: "USD",
        amount: winner.amount,
        purchaseType: "slot",
      });
    } catch (e) {
      req.log.warn({ e }, "Bid fulfill webhook failed");
    }

    res.json({
      success: true,
      message: `Slot #${slotNum} activated for ${winnerUser.username}. ${losers.length} other bidder(s) refunded.`,
      winner: { username: winnerUser.username, discordId: winnerUser.discordId, amount: parseFloat(winner.amount), slotNumber: slotNum },
      refunded: losers.length,
    });
  } catch (err) {
    req.log.error({ err }, "Bid fulfill failed");
    res.status(500).json({ error: "server_error", message: "Failed to fulfill bid" });
  }
});

// GET /api/admin/bids — list all active bids
router.get("/bids", async (req, res) => {
  try {
    const bids = await db
      .select({
        id: bidsTable.id,
        amount: bidsTable.amount,
        userId: bidsTable.userId,
        createdAt: bidsTable.createdAt,
        username: usersTable.username,
        discordId: usersTable.discordId,
      })
      .from(bidsTable)
      .innerJoin(usersTable, eq(bidsTable.userId, usersTable.id))
      .where(eq(bidsTable.status, "active"))
      .orderBy(desc(bidsTable.amount), bidsTable.createdAt);

    res.json({ bids: bids.map(b => ({ ...b, amount: parseFloat(b.amount) })) });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin bids");
    res.status(500).json({ error: "server_error" });
  }
});

// Force-run the payment poller immediately (super admin only)
router.post("/payments/run-poller", async (req, res) => {
  if (!isSuperAdmin(req.session.discordId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    await runPaymentPoller();
    res.json({ success: true, message: "Payment poller ran successfully" });
  } catch (err) {
    req.log.error({ err }, "Admin: run-poller failed");
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

// Force-complete a specific payment by its internal payment ID (super admin only)
router.post("/payments/force-complete", async (req, res) => {
  if (!isSuperAdmin(req.session.discordId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const { paymentId } = req.body;
  if (!paymentId) {
    res.status(400).json({ error: "paymentId required" });
    return;
  }

  try {
    const rows = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId)).limit(1);
    if (!rows.length) {
      res.status(404).json({ error: "not_found", message: "Payment not found" });
      return;
    }

    const payment = rows[0];

    if (payment.status === "completed") {
      res.json({ success: true, message: "Payment was already completed" });
      return;
    }

    if (payment.method === "balance-deposit-crypto" || payment.method === "balance-deposit-stripe") {
      const depositAmount = parseFloat(payment.usdAmount ?? payment.amount ?? "0");
      if (depositAmount <= 0) {
        res.status(400).json({ error: "invalid_amount", message: "Amount is 0" });
        return;
      }
      await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, payment.id));
      await db.update(usersTable)
        .set({ balance: sql`${usersTable.balance} + ${depositAmount.toFixed(2)}::numeric`, updatedAt: new Date() })
        .where(eq(usersTable.id, payment.userId));
      req.log.info({ paymentId, depositAmount }, "Admin force-completed balance deposit");
      res.json({ success: true, message: `Balance deposit of $${depositAmount.toFixed(2)} credited to user` });
    } else if (payment.slotNumber > 0) {
      await activateSlotShared(payment.userId, payment.slotNumber, payment.id, payment.derivationIndex ?? undefined);
      req.log.info({ paymentId, slotNumber: payment.slotNumber }, "Admin force-completed slot payment");
      res.json({ success: true, message: `Slot #${payment.slotNumber} activated for user` });
    } else {
      await db.update(paymentsTable).set({ status: "completed", updatedAt: new Date() }).where(eq(paymentsTable.id, payment.id));
      req.log.info({ paymentId }, "Admin force-marked payment as completed");
      res.json({ success: true, message: "Payment marked as completed" });
    }
  } catch (err) {
    req.log.error({ err }, "Admin force-complete failed");
    res.status(500).json({ error: "server_error", message: String(err) });
  }
});

// ── Reviews admin ──────────────────────────────────────────────────────────
router.get("/reviews", requireAdmin, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: reviewsTable.id,
        rating: reviewsTable.rating,
        body: reviewsTable.body,
        isVisible: reviewsTable.isVisible,
        createdAt: reviewsTable.createdAt,
        username: usersTable.username,
        avatar: usersTable.avatar,
        discordId: usersTable.discordId,
      })
      .from(reviewsTable)
      .innerJoin(usersTable, eq(reviewsTable.userId, usersTable.id))
      .orderBy(desc(reviewsTable.createdAt));
    res.json({ reviews: rows });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

router.patch("/reviews/:id/toggle", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "bad_id" }); return; }
    const [existing] = await db.select({ isVisible: reviewsTable.isVisible }).from(reviewsTable).where(eq(reviewsTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "not_found" }); return; }
    const next = !existing.isVisible;
    await db.update(reviewsTable).set({ isVisible: next }).where(eq(reviewsTable.id, id));
    res.json({ success: true, isVisible: next });
  } catch (err) {
    res.status(500).json({ error: "server_error" });
  }
});

export default router;

