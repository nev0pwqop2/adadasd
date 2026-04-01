import app from "./app";
import { logger } from "./lib/logger";
import { db, slotsTable, usersTable } from "@workspace/db";
import { sql, eq, and, gt, lte } from "drizzle-orm";
import { sendDiscordDM, removeGuildRole } from "./lib/discord.js";
import { runSlotCleanup, runAutoFulfillment } from "./lib/fulfillment.js";
import { runPaymentPoller } from "./lib/paymentPoller.js";
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

async function runMigrations() {
  const step = async (label: string, query: Parameters<typeof db.execute>[0]) => {
    try {
      await db.execute(query);
    } catch (err: any) {
      logger.warn({ label, msg: err?.message }, "DB migration step skipped");
    }
  };

  // ── Core tables (create if not exists) ──────────────────────────────────
  await step("create users", sql`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      discord_id VARCHAR(64) NOT NULL UNIQUE,
      username TEXT NOT NULL,
      avatar TEXT,
      email TEXT,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      guilds JSONB,
      balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      is_banned BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  await step("create settings", sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  await step("create oauth_states", sql`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      expires_at TIMESTAMP NOT NULL
    )
  `);
  await step("create slots", sql`
    CREATE TABLE IF NOT EXISTS slots (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slot_number INTEGER NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      purchased_at TIMESTAMP,
      expires_at TIMESTAMP,
      label TEXT,
      luarmor_user_id TEXT,
      hwid_reset_at TIMESTAMP,
      purchase_token TEXT,
      notified_24h BOOLEAN NOT NULL DEFAULT FALSE,
      notified_1h BOOLEAN NOT NULL DEFAULT FALSE,
      is_paused BOOLEAN NOT NULL DEFAULT FALSE,
      paused_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  await step("create payments", sql`
    CREATE TABLE IF NOT EXISTS payments (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slot_number INTEGER NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      currency TEXT,
      amount TEXT,
      address TEXT,
      tx_hash TEXT,
      derivation_index INTEGER,
      stripe_session_id TEXT,
      expires_at TIMESTAMP,
      split_sent BOOLEAN NOT NULL DEFAULT FALSE,
      usd_amount TEXT,
      coupon_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  await step("create preorders", sql`
    CREATE TABLE IF NOT EXISTS preorders (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount TEXT NOT NULL,
      currency TEXT,
      payment_id VARCHAR(64),
      status TEXT NOT NULL DEFAULT 'paid',
      hours_requested INTEGER,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  await step("create bids", sql`
    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      paid_with_balance BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  await step("create coupons", sql`
    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      code VARCHAR(32) NOT NULL UNIQUE,
      discount_type TEXT NOT NULL,
      discount_value NUMERIC(10,2) NOT NULL,
      max_uses INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMP,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);

  // ── Column additions (ALTER TABLE — safe even if column already exists) ──
  await step("slots.notified_24h", sql`ALTER TABLE slots ADD COLUMN IF NOT EXISTS notified_24h BOOLEAN NOT NULL DEFAULT FALSE`);
  await step("slots.notified_1h", sql`ALTER TABLE slots ADD COLUMN IF NOT EXISTS notified_1h BOOLEAN NOT NULL DEFAULT FALSE`);
  await step("slots.purchase_token", sql`ALTER TABLE slots ADD COLUMN IF NOT EXISTS purchase_token TEXT`);
  await step("slots.is_paused", sql`ALTER TABLE slots ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT FALSE`);
  await step("slots.paused_at", sql`ALTER TABLE slots ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP`);
  await step("users.is_banned", sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE`);
  await step("payments.split_sent", sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS split_sent BOOLEAN NOT NULL DEFAULT FALSE`);
  await step("payments.usd_amount", sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS usd_amount TEXT`);
  await step("payments.coupon_id", sql`ALTER TABLE payments ADD COLUMN IF NOT EXISTS coupon_id INTEGER`);
  await step("preorders.hours_requested", sql`ALTER TABLE preorders ADD COLUMN IF NOT EXISTS hours_requested INTEGER`);
  await step("bids.paid_with_balance", sql`ALTER TABLE bids ADD COLUMN IF NOT EXISTS paid_with_balance BOOLEAN NOT NULL DEFAULT FALSE`);

  // ── Integrity constraints ─────────────────────────────────────────────────
  await step("slots dedup", sql`
    DELETE FROM slots
    WHERE id NOT IN (
      SELECT DISTINCT ON (user_id, slot_number) id
      FROM slots
      ORDER BY user_id, slot_number, is_active DESC, id DESC
    )
  `);
  await step("slots unique constraint", sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'slots_user_slot_unique'
      ) THEN
        ALTER TABLE slots ADD CONSTRAINT slots_user_slot_unique UNIQUE (user_id, slot_number);
      END IF;
    END$$
  `);

  await step("add notified_10m to slots", sql`
    ALTER TABLE slots ADD COLUMN IF NOT EXISTS notified_10m BOOLEAN NOT NULL DEFAULT FALSE
  `);

  // Reset notified_10m for active slots that expire more than 20 minutes from now —
  // these clearly haven't been legitimately notified (the old scheduler may have set the
  // flag even when the DM failed), so resetting lets the new polling code send the DM.
  await step("reset stale notified_10m flags", sql`
    UPDATE slots
    SET notified_10m = FALSE
    WHERE is_active = TRUE
      AND notified_10m = TRUE
      AND expires_at > NOW() + INTERVAL '20 minutes'
  `);

  await step("create user_sessions", sql`
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid VARCHAR NOT NULL COLLATE "default",
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL,
      CONSTRAINT session_pkey PRIMARY KEY (sid)
    )
  `);
  await step("create user_sessions expire index", sql`
    CREATE INDEX IF NOT EXISTS idx_session_expire ON user_sessions (expire)
  `);

  logger.info("DB migrations complete");
}

const BUYER_ROLE_ID = process.env.DISCORD_SLOT_HOLDER_ROLE_ID ?? "1475135841994014761";
const VOUCH_CHANNEL_ID = "1461450196377403472";

async function runExpiryNotifications() {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return;

  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);
    const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const in1m = new Date(now.getTime() + 1 * 60 * 1000);
    const in15m = new Date(now.getTime() + 15 * 60 * 1000);
    const slots24h = await db
      .select({ id: slotsTable.id, userId: slotsTable.userId, expiresAt: slotsTable.expiresAt })
      .from(slotsTable)
      .where(and(eq(slotsTable.isActive, true), eq(slotsTable.notified24h, false), gt(slotsTable.expiresAt, in24h), lte(slotsTable.expiresAt, in25h)));

    for (const slot of slots24h) {
      const userRows = await db.select({ discordId: usersTable.discordId, username: usersTable.username })
        .from(usersTable).where(eq(usersTable.id, slot.userId)).limit(1);
      if (!userRows.length) continue;
      const ts = Math.floor(slot.expiresAt!.getTime() / 1000);
      await sendDiscordDM(userRows[0].discordId,
        `⏰ **Slot expiry reminder** — Hey ${userRows[0].username}, your Exe Joiner slot expires in **24 hours** (<t:${ts}:F>). Renew it before it's gone!`
      );
      await db.update(slotsTable).set({ notified24h: true }).where(eq(slotsTable.id, slot.id));
    }

    const slots1h = await db
      .select({ id: slotsTable.id, userId: slotsTable.userId, expiresAt: slotsTable.expiresAt })
      .from(slotsTable)
      .where(and(eq(slotsTable.isActive, true), eq(slotsTable.notified1h, false), gt(slotsTable.expiresAt, in1h), lte(slotsTable.expiresAt, in2h)));

    for (const slot of slots1h) {
      const userRows = await db.select({ discordId: usersTable.discordId, username: usersTable.username })
        .from(usersTable).where(eq(usersTable.id, slot.userId)).limit(1);
      if (!userRows.length) continue;
      const ts = Math.floor(slot.expiresAt!.getTime() / 1000);
      await sendDiscordDM(userRows[0].discordId,
        `🚨 **Slot expiring soon!** — Hey ${userRows[0].username}, your Exe Joiner slot expires in **1 hour** (<t:${ts}:F>). Act now to keep your access!`
      );
      await db.update(slotsTable).set({ notified1h: true }).where(eq(slotsTable.id, slot.id));
    }

    const slots10m = await db
      .select({ id: slotsTable.id, userId: slotsTable.userId, expiresAt: slotsTable.expiresAt })
      .from(slotsTable)
      .where(and(eq(slotsTable.isActive, true), eq(slotsTable.notified10m, false), gt(slotsTable.expiresAt, in1m), lte(slotsTable.expiresAt, in15m)));

    for (const slot of slots10m) {
      const userRows = await db.select({ discordId: usersTable.discordId, username: usersTable.username })
        .from(usersTable).where(eq(usersTable.id, slot.userId)).limit(1);
      if (!userRows.length) continue;
      await sendDiscordDM(userRows[0].discordId,
        `⚠️ **10 minutes left!** — Hey ${userRows[0].username}, your Exe Joiner slot expires in **10 minutes**. Make sure to vouch all your steals! <#${VOUCH_CHANNEL_ID}>`
      );
      await db.update(slotsTable).set({ notified10m: true } as any).where(eq(slotsTable.id, slot.id));
    }

  } catch (err) {
    logger.warn({ err }, "Expiry notification job failed");
  }
}

/** On startup: remove buyer role from anyone whose slot is no longer active */
async function auditBuyerRoles() {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return;
  try {
    // Find all users who have a slot row but no currently active slot
    const usersWithSlots = await db
      .selectDistinct({ discordId: usersTable.discordId })
      .from(slotsTable)
      .innerJoin(usersTable, eq(slotsTable.userId, usersTable.id));

    const activeUsers = new Set(
      (await db
        .selectDistinct({ discordId: usersTable.discordId })
        .from(slotsTable)
        .innerJoin(usersTable, eq(slotsTable.userId, usersTable.id))
        .where(eq(slotsTable.isActive, true))
      ).map((r) => r.discordId)
    );

    let removed = 0;
    for (const { discordId } of usersWithSlots) {
      if (!activeUsers.has(discordId)) {
        await removeGuildRole(discordId, BUYER_ROLE_ID);
        removed++;
      }
    }
    if (removed > 0) logger.info({ removed }, "Startup role audit: removed buyer role from expired users");
  } catch (err) {
    logger.warn({ err }, "Startup buyer role audit failed");
  }
}

/** Combined cleanup + fulfillment — run this whenever a slot might have freed up */
async function cleanupThenFulfill() {
  const freed = await runSlotCleanup();
  if (freed > 0) {
    logger.info({ freed }, "Slots cleaned up — running auto-fulfillment");
  }
  await runAutoFulfillment();
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function startDiscordBot() {
  if (process.env.REPLIT_DEV_DOMAIN) return;

  const botPath = path.resolve(process.cwd(), "artifacts/discord-bot/dist/index.js");

  // Check file exists before spawning — avoids crashing the server if bot isn't built
  if (!existsSync(botPath)) {
    logger.warn({ botPath }, "Discord bot dist not found — skipping bot startup");
    return;
  }

  const bot = spawn("node", [botPath], {
    stdio: "inherit",
    env: process.env,
  });

  bot.on("error", (err) => {
    logger.warn({ err }, "Discord bot spawn error — retrying in 10s");
    setTimeout(startDiscordBot, 10000);
  });

  bot.on("exit", (code) => {
    logger.warn({ code }, "Discord bot exited — restarting in 60s");
    setTimeout(startDiscordBot, 60000);
  });

  logger.info("Discord bot process started");
}

// Internal trigger endpoint — called by Discord bot after cleanup, or admin after slot changes.
// Only accessible from the same host (loopback) to prevent external abuse.
app.post("/api/internal/trigger-fulfillment", (req, res) => {
  const socket = (req.socket as any);
  const remoteAddr = socket?.remoteAddress ?? "";
  const isLoopback = remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
  if (!isLoopback) {
    logger.warn({ remoteAddr }, "Rejected external call to internal trigger endpoint");
    res.status(403).json({ error: "forbidden" });
    return;
  }
  // Fire and forget — don't await so we respond immediately
  cleanupThenFulfill().catch((err) => logger.warn({ err }, "Triggered fulfillment failed"));
  res.json({ ok: true });
});

// Bind the port IMMEDIATELY so Render's health check passes,
// then run migrations and start background jobs asynchronously.
const server = app.listen(port, () => {
  logger.info({ port }, "Server listening");
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

runMigrations()
  .then(() => {
    logger.info("DB migrations complete — starting background jobs");

    // Expiry notifications every minute
    setInterval(runExpiryNotifications, 60 * 1000);
    setTimeout(runExpiryNotifications, 10_000);

    // Cleanup + fulfillment every 60 seconds as a safety net
    setInterval(cleanupThenFulfill, 60 * 1000);
    setTimeout(cleanupThenFulfill, 15_000);

    // Payment poller — auto-complete pending crypto payments every 30 seconds
    setInterval(() => runPaymentPoller().catch(err => logger.warn({ err }, "Payment poller error")), 30 * 1000);
    setTimeout(() => runPaymentPoller().catch(err => logger.warn({ err }, "Payment poller error")), 15_000);

    // Audit buyer roles on startup — remove role from anyone whose slot has expired
    setTimeout(() => auditBuyerRoles().catch(err => logger.warn({ err }, "Startup role audit error")), 20_000);

    startDiscordBot();
  })
  .catch((err) => {
    logger.error({ err }, "DB migrations failed — server running but DB may be unavailable");
  });
