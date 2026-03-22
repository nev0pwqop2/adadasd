import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder,
  Events,
  Message,
} from "discord.js";
import pg from "pg";

const { Client: PgClient } = pg;

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;

const ALLOWED_USER_IDS = new Set(["1279091875378368595", "905033435817586749", "1435005690824622090"]);

if (!DISCORD_BOT_TOKEN || !DISCORD_APPLICATION_ID || !NEON_DATABASE_URL) {
  console.error("Missing required env vars: DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, NEON_DATABASE_URL");
  process.exit(1);
}

const db = new PgClient({ connectionString: NEON_DATABASE_URL });
await db.connect();
console.log("Connected to database");

const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

// Clear any existing slash commands
async function clearSlashCommands() {
  try {
    await rest.put(Routes.applicationCommands(DISCORD_APPLICATION_ID!), { body: [] });
    console.log("Slash commands cleared");
  } catch (err) {
    console.error("Failed to clear slash commands:", err);
  }
}

// Pending whitelist sessions: userId -> { username, slot?, createdAt }
const pendingSessions = new Map<string, { username: string; slot?: number; createdAt: number }>();

// Clean up sessions older than 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of pendingSessions.entries()) {
    if (now - session.createdAt > 5 * 60 * 1000) {
      pendingSessions.delete(userId);
    }
  }
}, 60_000);

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

async function processWhitelist(message: Message, username: string, hours: number, preferredSlot?: number) {
  const userRes = await db.query(`SELECT * FROM users WHERE username = $1 LIMIT 1`, [username]);
  if (userRes.rows.length === 0) {
    await message.reply(`❌ User **${username}** not found. They must log in to the site at least once first.`);
    return;
  }

  const user = userRes.rows[0];
  const slotNumber = await getAvailableSlot(preferredSlot);

  if (slotNumber === null) {
    await message.reply(
      preferredSlot
        ? `❌ Slot #${preferredSlot} is already active. Choose a different slot.`
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

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("✅ Whitelist Successful")
    .addFields(
      { name: "User", value: `\`${username}\``, inline: true },
      { name: "Slot", value: `#${slotNumber}`, inline: true },
      { name: "Duration", value: `${hours} hour(s)`, inline: true },
      { name: "Expires", value: `<t:${unixExpiry}:F>\n<t:${unixExpiry}:R>`, inline: false }
    )
    .setTimestamp();

  await message.reply({ embeds: [embed] });
  console.log(`[WHITELIST] ${message.author.username} whitelisted "${username}" on slot #${slotNumber} for ${hours}h`);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Bot online as ${c.user.tag}`);
  await clearSlashCommands();
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;

  // Handle DM reply to a pending session
  if (!message.guild && pendingSessions.has(message.author.id)) {
    const session = pendingSessions.get(message.author.id)!;
    const hours = parseInt(message.content.trim());

    if (isNaN(hours) || hours < 1 || hours > 720) {
      await message.reply("❌ Please reply with a valid number of hours (1–720).");
      return;
    }

    pendingSessions.delete(message.author.id);

    try {
      await processWhitelist(message, session.username, hours, session.slot);
    } catch (err) {
      console.error("Whitelist error:", err);
      await message.reply("❌ An error occurred while processing the whitelist.");
    }
    return;
  }

  // Handle !whitelist command in server channels
  if (!message.content.toLowerCase().startsWith("!whitelist")) return;

  if (!ALLOWED_USER_IDS.has(message.author.id)) {
    await message.reply("❌ You are not authorized to use this command.");
    return;
  }

  const args = message.content.slice("!whitelist".length).trim().split(/\s+/).filter(Boolean);
  const username = args[0];
  const preferredSlot = args[1] ? parseInt(args[1]) : undefined;

  if (!username) {
    await message.reply("Usage: `!whitelist <username> [slot]`");
    return;
  }

  // Verify user exists before opening DM
  try {
    const userRes = await db.query(`SELECT id FROM users WHERE username = $1 LIMIT 1`, [username]);
    if (userRes.rows.length === 0) {
      await message.reply(`❌ User **${username}** not found. They must log in to the site at least once first.`);
      return;
    }
  } catch (err) {
    console.error("DB error:", err);
    await message.reply("❌ Database error. Try again.");
    return;
  }

  // Store pending session
  pendingSessions.set(message.author.id, { username, slot: preferredSlot, createdAt: Date.now() });

  // Send DM embed
  try {
    const dmChannel = await message.author.createDM();

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("⚙️ Whitelist Setup")
      .setDescription(
        `You are about to whitelist **${username}**${preferredSlot ? ` on Slot **#${preferredSlot}**` : " *(auto-assign slot)*"}.`
      )
      .addFields({
        name: "How many hours?",
        value: "Reply to this DM with the number of hours.\n\nExample: `24`\n\n*Prompt expires in 5 minutes.*",
      })
      .setTimestamp();

    await dmChannel.send({ embeds: [embed] });
    await message.react("✅");
  } catch {
    await message.reply("❌ I couldn't DM you. Please open your DMs and try again.");
    pendingSessions.delete(message.author.id);
  }
});

await client.login(DISCORD_BOT_TOKEN);
