import { Router } from "express";
import { db, slotsTable, usersTable, paymentsTable, preordersTable, bidsTable, couponsTable } from "@workspace/db";
import { eq, and, sql, inArray, lte, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getSettings } from "../lib/settings.js";
import { isLuarmorConfigured, createLuarmorUser, deleteLuarmorUser, getLuarmorUsers, resetLuarmorHwid } from "../lib/luarmor.js";
import { sendDiscordDM } from "../lib/discord.js";

const router = Router();

router.patch("/:id/label", requireAuth, async (req, res) => {
  const slotId = parseInt(req.params.id as string, 10);
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

const HWID_RESET_UNLIMITED_IDS = new Set(["905033435817586749"]);

router.post("/:id/reset-hwid", requireAuth, async (req, res) => {
  const slotId = parseInt(req.params.id as string, 10);
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

    const slot = existing[0];

    if (!slot.isActive) {
      res.status(400).json({ error: "slot_inactive", message: "Slot is not active" });
      return;
    }

    if (!isLuarmorConfigured()) {
      res.status(503).json({ error: "luarmor_not_configured", message: "Luarmor is not configured on this server" });
      return;
    }

    // Resolve luarmor key — use stored one or fall back to discord_id lookup
    let luarmorKey = slot.luarmorUserId;
    if (!luarmorKey) {
      const userRow = await db.select({ discordId: usersTable.discordId }).from(usersTable).where(eq(usersTable.id, slot.userId)).limit(1);
      if (userRow.length) {
        const allUsers = await getLuarmorUsers();
        const match = allUsers.find(u => u.discord_id === userRow[0].discordId);
        if (match) {
          luarmorKey = match.user_key;
          await db.update(slotsTable).set({ luarmorUserId: luarmorKey }).where(eq(slotsTable.id, slotId));
        }
      }
    }

    if (!luarmorKey) {
      res.status(400).json({ error: "no_key", message: "No script key found for this slot" });
      return;
    }

    // Check the requesting user's Discord ID for cooldown bypass
    const userRow = await db.select({ discordId: usersTable.discordId }).from(usersTable).where(eq(usersTable.id, req.session.userId!)).limit(1);
    const isUnlimited = userRow.length && HWID_RESET_UNLIMITED_IDS.has(userRow[0].discordId);

    // Enforce 1 reset per 24 hours (skipped for unlimited users)
    if (!isUnlimited && slot.hwidResetAt) {
      const hoursAgo = (Date.now() - new Date(slot.hwidResetAt).getTime()) / (1000 * 60 * 60);
      if (hoursAgo < 24) {
        const nextReset = new Date(new Date(slot.hwidResetAt).getTime() + 24 * 60 * 60 * 1000);
        res.status(429).json({
          error: "on_cooldown",
          message: `HWID reset is on cooldown. Next reset available at ${nextReset.toISOString()}`,
          nextResetAt: nextReset.toISOString(),
        });
        return;
      }
    }

    await resetLuarmorHwid(luarmorKey);
    await db.update(slotsTable).set({ hwidResetAt: new Date() }).where(eq(slotsTable.id, slotId));

    res.json({ success: true, message: "HWID reset successfully" });
  } catch (err: any) {
    req.log.error({ err }, "Failed to reset HWID");
    const msg = err?.message ?? "Failed to reset HWID";
    res.status(500).json({ error: "server_error", message: msg });
  }
});

// POST /api/slots/gift — transfer your active slot to another Discord user
router.post("/gift", requireAuth, async (req, res) => {
  const { slotId, recipientDiscordId } = req.body as { slotId?: number; recipientDiscordId?: string };

  if (!slotId || typeof slotId !== "number") {
    res.status(400).json({ error: "invalid_slot", message: "slotId is required" });
    return;
  }
  if (!recipientDiscordId || typeof recipientDiscordId !== "string") {
    res.status(400).json({ error: "invalid_recipient", message: "recipientDiscordId is required" });
    return;
  }

  const senderId = req.session.userId!;

  try {
    const slot = await db.select().from(slotsTable).where(eq(slotsTable.id, slotId)).limit(1);
    if (!slot.length || slot[0].userId !== senderId || !slot[0].isActive) {
      res.status(404).json({ error: "not_found", message: "Active slot not found or you do not own it" });
      return;
    }

    const senderRow = await db.select({ discordId: usersTable.discordId }).from(usersTable).where(eq(usersTable.id, senderId)).limit(1);
    if (senderRow.length && senderRow[0].discordId === recipientDiscordId.trim()) {
      res.status(400).json({ error: "invalid_recipient", message: "You cannot gift a slot to yourself" });
      return;
    }

    const recipient = await db.select().from(usersTable).where(eq(usersTable.discordId, recipientDiscordId.trim())).limit(1);
    if (!recipient.length) {
      res.status(404).json({ error: "recipient_not_found", message: "Recipient user not found. They must have logged in at least once." });
      return;
    }
    if (recipient[0].isBanned) {
      res.status(403).json({ error: "recipient_banned", message: "That user is banned and cannot receive slots" });
      return;
    }

    const recipientId = recipient[0].id;
    const slotNum = slot[0].slotNumber;
    const expiresAt = slot[0].expiresAt;

    // Remove Luarmor key from sender
    if (isLuarmorConfigured() && slot[0].luarmorUserId) {
      try { await deleteLuarmorUser(slot[0].luarmorUserId); } catch (_) {}
    }

    // Deactivate ALL of sender's rows for this slot number (handles any duplicate rows)
    await db.update(slotsTable)
      .set({ isActive: false, expiresAt: null, purchasedAt: null, luarmorUserId: null, label: null, notified24h: false, notified1h: false })
      .where(and(eq(slotsTable.userId, senderId), eq(slotsTable.slotNumber, slotNum)));

    // Create Luarmor key for recipient
    let luarmorUserId: string | null = null;
    if (isLuarmorConfigured()) {
      try {
        const lu = await createLuarmorUser(recipient[0].discordId, recipient[0].username, expiresAt ?? undefined);
        luarmorUserId = lu.user_key;
      } catch (_) {}
    }

    // Upsert recipient's slot row
    const existingRecipientSlot = await db.select().from(slotsTable)
      .where(and(eq(slotsTable.userId, recipientId), eq(slotsTable.slotNumber, slotNum)))
      .limit(1);

    if (existingRecipientSlot.length) {
      await db.update(slotsTable)
        .set({ isActive: true, purchasedAt: new Date(), expiresAt, luarmorUserId, label: "Gift", notified24h: false, notified1h: false })
        .where(eq(slotsTable.id, existingRecipientSlot[0].id));
    } else {
      await db.insert(slotsTable).values({
        userId: recipientId, slotNumber: slotNum, isActive: true,
        purchasedAt: new Date(), expiresAt, luarmorUserId, label: "Gift",
      });
    }

    // DM the recipient
    if (expiresAt) {
      const ts = Math.floor(expiresAt.getTime() / 1000);
      await sendDiscordDM(recipient[0].discordId,
        `🎁 **You've been gifted a slot!** — Someone gifted you an Exe Joiner slot. It expires <t:${ts}:R> (<t:${ts}:F>). Check your dashboard to get your script key!`
      );
    }

    res.json({ success: true, message: `Slot gifted to ${recipient[0].username}` });
  } catch (err) {
    req.log.error({ err }, "Failed to gift slot");
    res.status(500).json({ error: "server_error", message: "Failed to gift slot" });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const { slotCount, pricePerDay, slotDurationHours, hourlyPricingEnabled, pricePerHour, minHours } = await getSettings();
    const currentUserId = req.session.userId!;

    // Verify the user still exists in the database (session may be stale after data resets)
    const userExists = await db.select({ id: usersTable.id, discordId: usersTable.discordId }).from(usersTable).where(eq(usersTable.id, currentUserId)).limit(1);
    if (!userExists.length) {
      req.session.destroy(() => {});
      res.status(401).json({ error: "session_invalid", message: "Session is no longer valid. Please log in again." });
      return;
    }
    const hwidUnlimited = HWID_RESET_UNLIMITED_IDS.has(userExists[0].discordId);

    // Ensure current user has slot rows
    const userSlots = await db.select().from(slotsTable).where(eq(slotsTable.userId, currentUserId));
    const existingNums = new Set(userSlots.map((s) => s.slotNumber));
    const toCreate = [];
    for (let i = 1; i <= slotCount; i++) {
      if (!existingNums.has(i)) toCreate.push({ userId: currentUserId, slotNumber: i, isActive: false });
    }
    if (toCreate.length) await db.insert(slotsTable).values(toCreate);

    const now = new Date();

    // Step 1: Expire any slots whose time is up — skip paused slots (their expiry is extended on unpause)
    const expiring = await db.select().from(slotsTable)
      .where(and(eq(slotsTable.isActive, true), eq(slotsTable.isPaused, false), lte(slotsTable.expiresAt, now)));
    if (isLuarmorConfigured() && expiring.length > 0) {
      // Delete keys we have stored
      await Promise.allSettled(
        expiring.filter(s => s.luarmorUserId).map(s => deleteLuarmorUser(s.luarmorUserId!))
      );
      // For expired slots with no stored key, fall back to discord_id lookup
      const noKey = expiring.filter(s => !s.luarmorUserId);
      if (noKey.length) {
        const ownerIds = [...new Set(noKey.map(s => s.userId))];
        const ownerRows = await db.select({ id: usersTable.id, discordId: usersTable.discordId })
          .from(usersTable).where(inArray(usersTable.id, ownerIds));
        const discordIds = new Set(ownerRows.map(o => o.discordId));
        if (discordIds.size) {
          const allLuarmorUsers = await getLuarmorUsers();
          await Promise.allSettled(
            allLuarmorUsers.filter(u => discordIds.has(u.discord_id)).map(u => deleteLuarmorUser(u.user_key))
          );
        }
      }
    }
    if (expiring.length > 0) {
      await db.update(slotsTable)
        .set({ isActive: false, expiresAt: null, purchasedAt: null, label: null, luarmorUserId: null })
        .where(and(eq(slotsTable.isActive, true), eq(slotsTable.isPaused, false), lte(slotsTable.expiresAt, now)));
    }

    // Step 2: Fetch all currently active slots
    let allActiveSlots = await db
      .select()
      .from(slotsTable)
      .where(and(eq(slotsTable.isActive, true), lte(slotsTable.slotNumber, slotCount)));

    // Step 3: Unified priority queue — bids and preorders compete by amount (highest wins)
    const freeSlotNums = Array.from({ length: slotCount }, (_, i) => i + 1)
      .filter(n => !allActiveSlots.some(s => s.slotNumber === n));

    if (freeSlotNums.length > 0) {
      const paidPreorders = await db.select().from(preordersTable)
        .where(eq(preordersTable.status, "paid"))
        .orderBy(sql`CAST(${preordersTable.amount} AS NUMERIC) DESC`, preordersTable.createdAt);

      const activeBids = await db.select().from(bidsTable)
        .where(and(eq(bidsTable.status, "active"), eq(bidsTable.paidWithBalance, true)))
        .orderBy(sql`CAST(${bidsTable.amount} AS NUMERIC) DESC`, bidsTable.createdAt);

      // Merge into one list, sorted by amount descending (preorder wins ties — placed first)
      type Claimant =
        | { kind: "preorder"; id: number; userId: string; amount: number; hoursRequested: number | null }
        | { kind: "bid"; id: number; userId: string; amount: number };

      const claimants: Claimant[] = [
        ...paidPreorders.map(p => ({ kind: "preorder" as const, id: p.id, userId: p.userId, amount: parseFloat(p.amount), hoursRequested: p.hoursRequested ?? null })),
        ...activeBids.map(b => ({ kind: "bid" as const, id: b.id, userId: b.userId, amount: parseFloat(b.amount) })),
      ].sort((a, b) => {
        if (b.amount !== a.amount) return b.amount - a.amount;
        // tie-break: preorders beat bids (they committed first)
        if (a.kind === "preorder" && b.kind === "bid") return -1;
        if (a.kind === "bid" && b.kind === "preorder") return 1;
        return 0;
      });

      const toAssign = Math.min(freeSlotNums.length, claimants.length);
      for (let i = 0; i < toAssign; i++) {
        const claimant = claimants[i];
        const slotNum = freeSlotNums[i];
        const hours = claimant.kind === "preorder" && claimant.hoursRequested
          ? claimant.hoursRequested
          : slotDurationHours;
        const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);

        let luarmorUserId: string | null = null;
        if (isLuarmorConfigured()) {
          try {
            const ownerUser = await db.select().from(usersTable).where(eq(usersTable.id, claimant.userId)).limit(1);
            if (ownerUser.length) {
              const lu = await createLuarmorUser(ownerUser[0].discordId, ownerUser[0].username, expiresAt);
              luarmorUserId = lu.user_key;
            }
          } catch (e) {}
        }

        const existingRow = await db.select().from(slotsTable)
          .where(and(eq(slotsTable.userId, claimant.userId), eq(slotsTable.slotNumber, slotNum)))
          .limit(1);
        if (existingRow.length) {
          await db.update(slotsTable)
            .set({ isActive: true, purchasedAt: now, expiresAt, label: null, luarmorUserId, notified24h: false, notified1h: false })
            .where(and(eq(slotsTable.userId, claimant.userId), eq(slotsTable.slotNumber, slotNum)));
        } else {
          await db.insert(slotsTable).values({ userId: claimant.userId, slotNumber: slotNum, isActive: true, purchasedAt: now, expiresAt, luarmorUserId });
        }

        if (claimant.kind === "preorder") {
          await db.update(preordersTable).set({ status: "fulfilled" }).where(eq(preordersTable.id, claimant.id));
          try {
            const u = await db.select({ discordId: usersTable.discordId, username: usersTable.username }).from(usersTable).where(eq(usersTable.id, claimant.userId)).limit(1);
            if (u.length) {
              const ts = Math.floor(expiresAt.getTime() / 1000);
              await sendDiscordDM(u[0].discordId,
                `✅ **Pre-order fulfilled!** — Hey ${u[0].username}, your Exe Joiner slot is now active! It expires <t:${ts}:R>. Check your dashboard to get your script key!`
              );
            }
          } catch (_) {}
        } else {
          await db.update(bidsTable).set({ status: "won", updatedAt: now }).where(eq(bidsTable.id, claimant.id));
          try {
            const u = await db.select({ discordId: usersTable.discordId, username: usersTable.username }).from(usersTable).where(eq(usersTable.id, claimant.userId)).limit(1);
            if (u.length) {
              const ts = Math.floor(expiresAt.getTime() / 1000);
              await sendDiscordDM(u[0].discordId,
                `🏆 **Your bid won!** — Hey ${u[0].username}, your Exe Joiner bid of $${claimant.amount.toFixed(2)} won a slot! It expires <t:${ts}:R>. Check your dashboard to get your script key!`
              );
            }
          } catch (_) {}
        }
      }

      // Re-fetch active slots after all assignments
      allActiveSlots = await db
        .select()
        .from(slotsTable)
        .where(and(eq(slotsTable.isActive, true), lte(slotsTable.slotNumber, slotCount)));
    }

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
    let mySlots = await db
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.userId, currentUserId))
      .orderBy(slotsTable.slotNumber);

    // Retroactively create Luarmor keys for active slots missing one
    if (isLuarmorConfigured()) {
      const currentUser = await db.select().from(usersTable).where(eq(usersTable.id, currentUserId)).limit(1);
      if (currentUser.length) {
        for (const slot of mySlots) {
          if (slot.isActive && !slot.luarmorUserId) {
            try {
              const lu = await createLuarmorUser(currentUser[0].discordId, currentUser[0].username, slot.expiresAt ?? undefined);
              await db.update(slotsTable).set({ luarmorUserId: lu.user_key }).where(eq(slotsTable.id, slot.id));
              slot.luarmorUserId = lu.user_key;
            } catch (e) {
              // Non-fatal
            }
          }
        }
      }
    }

    const mySlotMap = Object.fromEntries(mySlots.map((s) => [s.slotNumber, s]));

    // Build unified response for each slot number
    const slots = Array.from({ length: slotCount }, (_, i) => {
      const num = i + 1;
      const mySlot = mySlotMap[num];
      const activeSlot = allActiveSlots.find((s) => s.slotNumber === num);

      if (mySlot?.isActive) {
        // Current user owns this slot
        const scriptKey = mySlot.luarmorUserId ?? null;
        const scriptUrl = process.env.LUARMOR_SCRIPT_URL ?? null;
        const script = scriptKey && scriptUrl
          ? `script_key="${scriptKey}";\nloadstring(game:HttpGet("${scriptUrl}"))()`
          : null;
        return {
          slotNumber: num,
          isActive: true,
          isOwner: true,
          owner: owners[currentUserId] ?? null,
          id: mySlot.id,
          purchasedAt: mySlot.purchasedAt?.toISOString() ?? null,
          expiresAt: mySlot.expiresAt?.toISOString() ?? null,
          label: mySlot.label,
          scriptKey,
          script,
          hwidResetAt: mySlot.hwidResetAt?.toISOString() ?? null,
          hwidUnlimited,
          isPaused: mySlot.isPaused,
          pausedAt: mySlot.pausedAt?.toISOString() ?? null,
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
          expiresAt: activeSlot.expiresAt?.toISOString() ?? null,
          label: null,
          isPaused: activeSlot.isPaused,
          pausedAt: activeSlot.pausedAt?.toISOString() ?? null,
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

    // Find the earliest expiry among all active slots (for the countdown timer)
    const activeExpiries = allActiveSlots
      .map((s) => s.expiresAt)
      .filter((e): e is Date => e instanceof Date && !isNaN(e.getTime()));
    const nextExpiresAt = activeExpiries.length
      ? new Date(Math.min(...activeExpiries.map((d) => d.getTime()))).toISOString()
      : null;

    res.json({ slots, totalSlots: slotCount, pricePerDay, slotDurationHours, hourlyPricingEnabled, pricePerHour, minHours, nextExpiresAt });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch slots");
    res.status(500).json({ error: "server_error", message: "Failed to fetch slots" });
  }
});

router.get("/leaderboard", requireAuth, async (req, res) => {
  try {
    const { slotDurationHours, pricePerDay } = await getSettings();

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
      const validAmt = isNaN(amt) ? 0 : amt;
      totals[p.userId].totalSpent += validAmt;
      const hoursForPayment = pricePerDay > 0
        ? Math.round((validAmt / pricePerDay) * slotDurationHours)
        : slotDurationHours;
      totals[p.userId].totalHours += hoursForPayment;
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
