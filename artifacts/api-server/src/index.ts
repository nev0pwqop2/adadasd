import app from "./app";
import { logger } from "./lib/logger";
import { db, slotsTable, usersTable } from "@workspace/db";
import { sql, eq, and, gt, lte } from "drizzle-orm";
import { sendDiscordDM } from "./lib/discord.js";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

async function runMigrations() {
  try {
    await db.execute(sql`
      ALTER TABLE bids ADD COLUMN IF NOT EXISTS paid_with_balance BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS split_sent BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS usd_amount TEXT
    `);
    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE slots ADD COLUMN IF NOT EXISTS notified_24h BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE slots ADD COLUMN IF NOT EXISTS notified_1h BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
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
    await db.execute(sql`
      ALTER TABLE preorders ADD COLUMN IF NOT EXISTS hours_requested INTEGER
    `);
    // Deduplicate slots: keep the active row (or latest by id) per (user_id, slot_number)
    await db.execute(sql`
      DELETE FROM slots
      WHERE id NOT IN (
        SELECT DISTINCT ON (user_id, slot_number) id
        FROM slots
        ORDER BY user_id, slot_number, is_active DESC, id DESC
      )
    `);
    // Add unique constraint so duplicates can never form again
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'slots_user_slot_unique'
        ) THEN
          ALTER TABLE slots ADD CONSTRAINT slots_user_slot_unique UNIQUE (user_id, slot_number);
        END IF;
      END$$
    `);
    logger.info("DB migrations applied");
  } catch (err) {
    logger.warn({ err }, "DB migration step skipped or failed");
  }
}

async function runExpiryNotifications() {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return;

  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);
    const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);

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
  } catch (err) {
    logger.warn({ err }, "Expiry notification job failed");
  }
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
  // Only spawn the bot on Render (production) — on Replit it runs as its own workflow
  if (process.env.REPLIT_DEV_DOMAIN) return;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const botPath = path.resolve(__dirname, "../../discord-bot/src/index.ts");

  const bot = spawn("npx", ["tsx", botPath], {
    stdio: "inherit",
    env: process.env,
  });

  bot.on("exit", (code) => {
    logger.warn({ code }, "Discord bot exited — restarting in 5s");
    setTimeout(startDiscordBot, 5000);
  });

  logger.info("Discord bot process started");
}

runMigrations().then(() => {
  app.listen(port, () => {
    logger.info({ port }, "Server listening");
    setInterval(runExpiryNotifications, 5 * 60 * 1000);
    setTimeout(runExpiryNotifications, 10_000);
    startDiscordBot();
  });
});
