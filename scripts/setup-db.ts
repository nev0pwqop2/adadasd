import pg from "pg";

const { Client } = pg;

const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("No database URL found");

const client = new Client({ connectionString });

async function setup() {
  await client.connect();
  console.log("Connected to database");

  await client.query(`
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
  console.log("✓ users");

  await client.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  console.log("✓ settings");

  await client.query(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      expires_at TIMESTAMP NOT NULL
    )
  `);
  console.log("✓ oauth_states");

  await client.query(`
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
      notified_24h BOOLEAN NOT NULL DEFAULT FALSE,
      notified_1h BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  console.log("✓ slots");

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'slots_user_slot_unique'
      ) THEN
        ALTER TABLE slots ADD CONSTRAINT slots_user_slot_unique UNIQUE (user_id, slot_number);
      END IF;
    END$$
  `);
  console.log("✓ slots unique constraint");

  await client.query(`
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
  console.log("✓ coupons");

  await client.query(`
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
  console.log("✓ payments");

  await client.query(`
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
  console.log("✓ preorders");

  await client.query(`
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
  console.log("✓ bids");

  await client.end();
  console.log("\nAll tables created successfully!");
}

setup().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
