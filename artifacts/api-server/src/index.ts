import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function runMigrations() {
  try {
    await db.execute(sql`
      ALTER TABLE bids ADD COLUMN IF NOT EXISTS paid_with_balance BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS split_sent BOOLEAN NOT NULL DEFAULT FALSE
    `);
    logger.info("DB migrations applied");
  } catch (err) {
    logger.warn({ err }, "DB migration step skipped or failed");
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

runMigrations().then(() => {
  app.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
});
