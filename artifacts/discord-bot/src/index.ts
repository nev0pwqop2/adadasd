import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Events,
} from "discord.js";
import pg from "pg";

const { Client: PgClient } = pg;

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const SUPABASE_DATABASE_URL = process.env.SUPABASE_DATABASE_URL;
const LUARMOR_API_KEY = process.env.LUARMOR_API_KEY;
const LUARMOR_PROJECT_ID = process.env.LUARMOR_PROJECT_ID;

const ALLOWED_USER_IDS = new Set(["1279091875378368595", "905033435817586749", "1435005690824622090", "1411024429365989456", "1485902008601804900", "633039714160738342"]);

if (!DISCORD_BOT_TOKEN || !DISCORD_APPLICATION_ID || !SUPABASE_DATABASE_URL) {
  console.error("Missing required env vars: DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, SUPABASE_DATABASE_URL");
  process.exit(1);
}

const db = new PgClient({ connectionString: SUPABASE_DATABASE_URL });
await db.connect();
console.log("Connected to database");

// ---------------------------------------------------------------------------
// Luarmor helpers (only active when LUARMOR_API_KEY + LUARMOR_PROJECT_ID set)
// ---------------------------------------------------------------------------

function luarmorConfigured(): boolean {
  return !!(LUARMOR_API_KEY && LUARMOR_PROJECT_ID);
}

async function luarmorRequest(path: string, options: RequestInit = {}): Promise<unknown> {
  if (!LUARMOR_API_KEY || !LUARMOR_PROJECT_ID) throw new Error("Luarmor not configured");
  const res = await fetch(`https://api.luarmor.net/v3${path}`, {
    ...options,
    headers: {
      Authorization: LUARMOR_API_KEY,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Luarmor ${res.status}: ${text}`);
  }
  return res.json();
}

async function luarmorCreateOrUpdateUser(discordId: string, username: string, expiresAt: Date): Promise<string> {
  const authExpire = Math.floor(expiresAt.getTime() / 1000);
  try {
    const data = await luarmorRequest(`/projects/${LUARMOR_PROJECT_ID}/users`, {
      method: "POST",
      body: JSON.stringify({ discord_id: discordId, note: username, auth_expire: authExpire }),
    }) as { user_key: string };
    return data.user_key;
  } catch {
    // User may already exist — find and update them
    const list = await luarmorRequest(`/projects/${LUARMOR_PROJECT_ID}/users`) as { users: { user_key: string; discord_id: string }[] };
    const existing = list.users?.find((u) => u.discord_id === discordId);
    if (existing) {
      await luarmorRequest(`/projects/${LUARMOR_PROJECT_ID}/users`, {
        method: "PATCH",
        body: JSON.stringify({ user_key: existing.user_key, auth_expire: authExpire, note: username }),
      });
      return existing.user_key;
    }
    throw new Error("Could not create or find Luarmor user");
  }
}

async function luarmorDeleteUser(userKey: string): Promise<void> {
  await luarmorRequest(
    `/projects/${LUARMOR_PROJECT_ID}/users?user_key=${encodeURIComponent(userKey)}`,
    { method: "DELETE" }
  );
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Whitelist a user by granting them a slot for a set duration")
    .addUserOption((opt) =>
      opt
        .setName("mention")
        .setDescription("Ping/mention the Discord user directly")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("username")
        .setDescription("Site username or Discord ID (use mention instead if possible)")
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("hours")
        .setDescription("Hours to whitelist for (can combine with minutes)")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(720)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("minutes")
        .setDescription("Extra minutes to whitelist for (can combine with hours)")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(59)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("slot")
        .setDescription("Specific slot number to assign (auto-assigns if not set)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("unwhitelist")
    .setDescription("Remove a user's active slot(s)")
    .addUserOption((opt) =>
      opt
        .setName("mention")
        .setDescription("Ping/mention the Discord user directly")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("username")
        .setDescription("Site username or Discord ID (use mention instead if possible)")
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("slot")
        .setDescription("Specific slot number to remove (removes all active slots if not set)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50)
    )
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

async function registerCommands() {
  try {
    await rest.put(Routes.applicationCommands(DISCORD_APPLICATION_ID!), { body: commands });
    console.log("Slash commands registered globally");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

async function getAvailableSlot(preferredSlot?: number): Promise<number | null> {
  const settingsRes = await db.query(`SELECT value FROM settings WHERE key = 'slotCount' LIMIT 1`);
  const slotCount = settingsRes.rows.length > 0 ? parseInt(settingsRes.rows[0].value) : 10;

  if (preferredSlot) {
    const activeRes = await db.query(
      `SELECT 1 FROM slots WHERE slot_number = $1 AND is_active = true LIMIT 1`,
      [preferredSlot]
    );
    if (activeRes.rows.length > 0) return null;
    return preferredSlot;
  }

  const activeRes = await db.query(`SELECT DISTINCT slot_number FROM slots WHERE is_active = true`);
  const activeSlots = new Set<number>(activeRes.rows.map((r: { slot_number: number }) => r.slot_number));

  for (let i = 1; i <= slotCount; i++) {
    if (!activeSlots.has(i)) return i;
  }
  return null;
}

async function handleWhitelist(interaction: ChatInputCommandInteraction) {
  if (!ALLOWED_USER_IDS.has(interaction.user.id)) {
    await interaction.reply({ content: "❌ You are not authorized to use this command.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const mentionedUser = interaction.options.getUser("mention");
  const usernameRaw = interaction.options.getString("username")?.replace(/^@+/, "").trim();
  const hours = interaction.options.getInteger("hours") ?? 0;
  const minutes = interaction.options.getInteger("minutes") ?? 0;
  const preferredSlot = interaction.options.getInteger("slot") ?? undefined;

  if (!mentionedUser && !usernameRaw) {
    await interaction.editReply("❌ You must provide either a @mention or a username.");
    return;
  }

  const totalMs = (hours * 60 + minutes) * 60 * 1000;
  if (totalMs <= 0) {
    await interaction.editReply("❌ You must specify at least 1 minute (use the `hours` and/or `minutes` options).");
    return;
  }

  let userRes;
  let username: string;
  if (mentionedUser) {
    userRes = await db.query(`SELECT * FROM users WHERE discord_id = $1 LIMIT 1`, [mentionedUser.id]);
    username = mentionedUser.username;
  } else {
    const isSnowflake = /^\d{15,20}$/.test(usernameRaw!);
    userRes = isSnowflake
      ? await db.query(`SELECT * FROM users WHERE discord_id = $1 LIMIT 1`, [usernameRaw])
      : await db.query(`SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`, [usernameRaw]);
    username = usernameRaw!;
  }

  if (userRes.rows.length === 0) {
    await interaction.editReply(`❌ User **${username}** not found. They must log in to the site first, or try their Discord ID (a long number).`);
    return;
  }

  const user = userRes.rows[0];
  const slotNumber = await getAvailableSlot(preferredSlot);

  if (slotNumber === null) {
    await interaction.editReply(
      preferredSlot
        ? `❌ Slot #${preferredSlot} is already active. Choose a different slot or leave it blank for auto-assign.`
        : `❌ No available slots right now. All slots are currently active.`
    );
    return;
  }

  const expiresAt = new Date(Date.now() + totalMs);
  const purchasedAt = new Date();

  // Create or update Luarmor user if configured
  let luarmorUserId: string | null = null;
  if (luarmorConfigured()) {
    try {
      luarmorUserId = await luarmorCreateOrUpdateUser(user.discord_id, username, expiresAt);
      console.log(`[WHITELIST] Luarmor user created/updated: ${luarmorUserId}`);
    } catch (err) {
      console.error("[WHITELIST] Luarmor error (continuing anyway):", err);
    }
  }

  const existingSlot = await db.query(
    `SELECT id FROM slots WHERE user_id = $1 AND slot_number = $2 LIMIT 1`,
    [user.id, slotNumber]
  );

  if (existingSlot.rows.length > 0) {
    await db.query(
      `UPDATE slots SET is_active = true, purchased_at = $1, expires_at = $2, luarmor_user_id = $3
       WHERE user_id = $4 AND slot_number = $5`,
      [purchasedAt, expiresAt, luarmorUserId, user.id, slotNumber]
    );
  } else {
    await db.query(
      `INSERT INTO slots (user_id, slot_number, is_active, purchased_at, expires_at, luarmor_user_id)
       VALUES ($1, $2, true, $3, $4, $5)`,
      [user.id, slotNumber, purchasedAt, expiresAt, luarmorUserId]
    );
  }

  const unixExpiry = Math.floor(expiresAt.getTime() / 1000);
  const luarmorNote = luarmorUserId ? ` · Luarmor key issued` : luarmorConfigured() ? ` · ⚠️ Luarmor key failed` : "";

  const durationLabel = hours > 0 && minutes > 0
    ? `${hours}h ${minutes}m`
    : hours > 0 ? `${hours}h` : `${minutes}m`;

  console.log(`[WHITELIST] ${interaction.user.username} whitelisted "${username}" on slot #${slotNumber} for ${durationLabel}`);

  await interaction.editReply(
    `✅ **${username}** has been whitelisted on **Slot #${slotNumber}** for **${durationLabel}**.\nExpires: <t:${unixExpiry}:F> (<t:${unixExpiry}:R>)${luarmorNote}`
  );
}

async function handleUnwhitelist(interaction: ChatInputCommandInteraction) {
  if (!ALLOWED_USER_IDS.has(interaction.user.id)) {
    await interaction.reply({ content: "❌ You are not authorized to use this command.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const mentionedUser = interaction.options.getUser("mention");
  const usernameRaw = interaction.options.getString("username")?.replace(/^@+/, "").trim();
  const preferredSlot = interaction.options.getInteger("slot") ?? undefined;

  if (!mentionedUser && !usernameRaw) {
    await interaction.editReply("❌ You must provide either a @mention or a username.");
    return;
  }

  let userRes;
  let username: string;
  if (mentionedUser) {
    userRes = await db.query(`SELECT * FROM users WHERE discord_id = $1 LIMIT 1`, [mentionedUser.id]);
    username = mentionedUser.username;
  } else {
    const isSnowflake = /^\d{15,20}$/.test(usernameRaw!);
    userRes = isSnowflake
      ? await db.query(`SELECT * FROM users WHERE discord_id = $1 LIMIT 1`, [usernameRaw])
      : await db.query(`SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`, [usernameRaw]);
    username = usernameRaw!;
  }

  if (userRes.rows.length === 0) {
    await interaction.editReply(`❌ User **${username}** not found. Try their Discord ID (a long number) if the name doesn't work.`);
    return;
  }

  const user = userRes.rows[0];

  // Fetch the active slot(s) first so we can grab luarmor_user_id before clearing it
  let slotsToDeactivate: { slot_number: number; luarmor_user_id: string | null }[] = [];
  if (preferredSlot) {
    const res = await db.query(
      `SELECT slot_number, luarmor_user_id FROM slots WHERE user_id = $1 AND slot_number = $2 AND is_active = true`,
      [user.id, preferredSlot]
    );
    if (res.rows.length === 0) {
      await interaction.editReply(`❌ Slot #${preferredSlot} is not active for **${username}**.`);
      return;
    }
    slotsToDeactivate = res.rows;
  } else {
    const res = await db.query(
      `SELECT slot_number, luarmor_user_id FROM slots WHERE user_id = $1 AND is_active = true`,
      [user.id]
    );
    if (res.rows.length === 0) {
      await interaction.editReply(`❌ **${username}** has no active slots.`);
      return;
    }
    slotsToDeactivate = res.rows;
  }

  // Deactivate in DB
  if (preferredSlot) {
    await db.query(
      `UPDATE slots SET is_active = false, purchased_at = NULL, expires_at = NULL, luarmor_user_id = NULL
       WHERE user_id = $1 AND slot_number = $2`,
      [user.id, preferredSlot]
    );
  } else {
    await db.query(
      `UPDATE slots SET is_active = false, purchased_at = NULL, expires_at = NULL, luarmor_user_id = NULL
       WHERE user_id = $1`,
      [user.id]
    );
  }

  // Revoke Luarmor keys for any slots that had one
  if (luarmorConfigured()) {
    const keysToRevoke = slotsToDeactivate
      .map((s) => s.luarmor_user_id)
      .filter((k): k is string => !!k);

    // Deduplicate — a user might have the same key across multiple slots
    const uniqueKeys = [...new Set(keysToRevoke)];
    for (const key of uniqueKeys) {
      try {
        await luarmorDeleteUser(key);
        console.log(`[UNWHITELIST] Luarmor key revoked: ${key}`);
      } catch (err) {
        console.error(`[UNWHITELIST] Failed to revoke Luarmor key ${key}:`, err);
      }
    }
  }

  const count = slotsToDeactivate.length;
  console.log(`[UNWHITELIST] ${interaction.user.username} unwhitelisted "${username}"${preferredSlot ? ` slot #${preferredSlot}` : ` (${count} slot(s))`}`);

  if (preferredSlot) {
    await interaction.editReply(`✅ **${username}**'s Slot #${preferredSlot} has been deactivated and Luarmor key revoked.`);
  } else {
    await interaction.editReply(`✅ Removed **${count}** active slot(s) from **${username}** and revoked their Luarmor key(s).`);
  }
}

// ---------------------------------------------------------------------------
// Expiry cleanup job — runs every 5 minutes
// ---------------------------------------------------------------------------

async function cleanupExpiredSlots() {
  try {
    const expired = await db.query(`
      SELECT slot_number, luarmor_user_id, user_id
      FROM slots
      WHERE is_active = true
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
    `);

    if (expired.rows.length === 0) return;

    console.log(`[CLEANUP] Found ${expired.rows.length} expired slot(s) to clean up`);

    for (const slot of expired.rows) {
      // Delete Luarmor key if present
      if (luarmorConfigured() && slot.luarmor_user_id) {
        try {
          await luarmorDeleteUser(slot.luarmor_user_id);
          console.log(`[CLEANUP] Luarmor key deleted for slot #${slot.slot_number}: ${slot.luarmor_user_id}`);
        } catch (err) {
          console.error(`[CLEANUP] Failed to delete Luarmor key ${slot.luarmor_user_id}:`, err);
        }
      }

      // Deactivate slot in DB
      await db.query(
        `UPDATE slots SET is_active = false, purchased_at = NULL, expires_at = NULL, luarmor_user_id = NULL
         WHERE user_id = $1 AND slot_number = $2`,
        [slot.user_id, slot.slot_number]
      );
      console.log(`[CLEANUP] Slot #${slot.slot_number} deactivated for user ${slot.user_id}`);
    }
  } catch (err) {
    console.error("[CLEANUP] Error during expired slot cleanup:", err);
  }
}

// ---------------------------------------------------------------------------
// Bot setup
// ---------------------------------------------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  console.log(`Bot online as ${c.user.tag}`);
  await registerCommands();
  await cleanupExpiredSlots();
  setInterval(cleanupExpiredSlots, 2 * 60 * 1000);
  console.log("[CLEANUP] Expired slot cleanup job started (every 2 minutes)");
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const handler =
    interaction.commandName === "whitelist" ? handleWhitelist :
    interaction.commandName === "unwhitelist" ? handleUnwhitelist :
    null;

  if (handler) {
    try {
      await handler(interaction);
    } catch (err) {
      console.error(`${interaction.commandName} command error:`, err);
      const msg = "❌ An error occurred. Check the bot logs.";
      if (interaction.deferred) {
        await interaction.editReply(msg).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  }
});

await client.login(DISCORD_BOT_TOKEN);
