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
const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;

const ALLOWED_USER_IDS = new Set(["1279091875378368595", "905033435817586749", "1435005690824622090"]);

if (!DISCORD_BOT_TOKEN || !DISCORD_APPLICATION_ID || !NEON_DATABASE_URL) {
  console.error("Missing required env vars: DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, NEON_DATABASE_URL");
  process.exit(1);
}

const db = new PgClient({ connectionString: NEON_DATABASE_URL });
await db.connect();
console.log("Connected to database");

const commands = [
  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Whitelist a user by granting them a slot for a set duration")
    .addStringOption((opt) =>
      opt
        .setName("username")
        .setDescription("The username of the user (as shown on the site)")
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("hours")
        .setDescription("How many hours to whitelist the user for")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(720)
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
    .addStringOption((opt) =>
      opt
        .setName("username")
        .setDescription("The username of the user (as shown on the site)")
        .setRequired(true)
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

  const username = interaction.options.getString("username", true).replace(/^@+/, "");
  const hours = interaction.options.getInteger("hours", true);
  const preferredSlot = interaction.options.getInteger("slot") ?? undefined;

  const userRes = await db.query(`SELECT * FROM users WHERE username = $1 LIMIT 1`, [username]);

  if (userRes.rows.length === 0) {
    await interaction.editReply(`❌ User **${username}** not found. They must log in to the site at least once first.`);
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

  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const purchasedAt = new Date();

  const existingSlot = await db.query(
    `SELECT id FROM slots WHERE user_id = $1 AND slot_number = $2 LIMIT 1`,
    [user.id, slotNumber]
  );

  if (existingSlot.rows.length > 0) {
    await db.query(
      `UPDATE slots SET is_active = true, purchased_at = $1, expires_at = $2 WHERE user_id = $3 AND slot_number = $4`,
      [purchasedAt, expiresAt, user.id, slotNumber]
    );
  } else {
    await db.query(
      `INSERT INTO slots (user_id, slot_number, is_active, purchased_at, expires_at) VALUES ($1, $2, true, $3, $4)`,
      [user.id, slotNumber, purchasedAt, expiresAt]
    );
  }

  const unixExpiry = Math.floor(expiresAt.getTime() / 1000);

  console.log(`[WHITELIST] ${interaction.user.username} whitelisted "${username}" on slot #${slotNumber} for ${hours}h`);

  await interaction.editReply(
    `✅ **${username}** has been whitelisted on **Slot #${slotNumber}** for **${hours} hour(s)**.\nExpires: <t:${unixExpiry}:F> (<t:${unixExpiry}:R>)`
  );
}

async function handleUnwhitelist(interaction: ChatInputCommandInteraction) {
  if (!ALLOWED_USER_IDS.has(interaction.user.id)) {
    await interaction.reply({ content: "❌ You are not authorized to use this command.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const username = interaction.options.getString("username", true).replace(/^@+/, "");
  const preferredSlot = interaction.options.getInteger("slot") ?? undefined;

  const userRes = await db.query(`SELECT * FROM users WHERE username = $1 LIMIT 1`, [username]);
  if (userRes.rows.length === 0) {
    await interaction.editReply(`❌ User **${username}** not found.`);
    return;
  }

  const user = userRes.rows[0];

  if (preferredSlot) {
    const res = await db.query(
      `UPDATE slots SET is_active = false, purchased_at = NULL, expires_at = NULL
       WHERE user_id = $1 AND slot_number = $2 AND is_active = true`,
      [user.id, preferredSlot]
    );
    if (res.rowCount === 0) {
      await interaction.editReply(`❌ Slot #${preferredSlot} is not active for **${username}**.`);
      return;
    }
    await interaction.editReply(`✅ **${username}**'s Slot #${preferredSlot} has been deactivated.`);
  } else {
    const res = await db.query(
      `UPDATE slots SET is_active = false, purchased_at = NULL, expires_at = NULL
       WHERE user_id = $1 AND is_active = true`,
      [user.id]
    );
    const count = res.rowCount ?? 0;
    if (count === 0) {
      await interaction.editReply(`❌ **${username}** has no active slots.`);
      return;
    }
    await interaction.editReply(`✅ Removed **${count}** active slot(s) from **${username}**.`);
  }

  console.log(`[UNWHITELIST] ${interaction.user.username} unwhitelisted "${username}"${preferredSlot ? ` slot #${preferredSlot}` : " (all slots)"}`);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  console.log(`Bot online as ${c.user.tag}`);
  await registerCommands();
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
