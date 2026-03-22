export type PurchaseType = "slot" | "balance_deposit" | "preorder";

export async function sendDiscordDM(discordId: string, content: string): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return;

  try {
    const channelRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: discordId }),
    });
    if (!channelRes.ok) {
      const text = await channelRes.text().catch(() => "");
      console.error(`[discord dm] failed to open channel ${channelRes.status}: ${text}`);
      return;
    }
    const channel = (await channelRes.json()) as { id: string };

    const msgRes = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!msgRes.ok) {
      const text = await msgRes.text().catch(() => "");
      console.error(`[discord dm] failed to send message ${msgRes.status}: ${text}`);
    }
  } catch (err) {
    console.error("[discord dm] fetch error:", err);
  }
}

export async function sendPaymentWebhook(data: {
  username: string;
  discordId: string;
  method: string;
  currency?: string | null;
  amount?: string | null;
  slotNumber?: number | null;
  purchaseType?: PurchaseType;
  durationHours?: number | null;
  expiresAt?: Date | null;
}): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || "https://discord.com/api/webhooks/1485003373932449924/PtxZcUAA-mFsqK4mqaSHY-zpegH0somwQKk_bRjmFiD-BinTAq-71iUfQyxOf52RZFNx";
  if (!webhookUrl) return;

  const purchaseType = data.purchaseType ?? "slot";

  const isStripe = data.method === "stripe" || data.method === "balance-deposit-stripe" || data.method === "preorder-stripe";
  const isBalance = data.method === "balance";

  const methodLabel = isStripe
    ? "Card (Stripe)"
    : isBalance
      ? "Account Balance"
      : `Crypto (${data.currency ?? "?"})`;

  const amountLabel = data.amount
    ? isStripe || isBalance
      ? `$${parseFloat(data.amount).toFixed(2)} USD`
      : `${data.amount} ${data.currency ?? ""}`
    : "—";

  let title: string;
  let typeLabel: string;
  let color: number;

  switch (purchaseType) {
    case "balance_deposit":
      title = "💳 Balance Deposit";
      typeLabel = "Balance Deposit";
      color = 0x5865f2;
      break;
    case "preorder":
      title = "📋 Pre-order Placed";
      typeLabel = "Pre-order";
      color = 0xf5a623;
      break;
    default:
      title = "💰 New Slot Purchase";
      typeLabel = "Slot Purchase";
      color = 0x00ff88;
      break;
  }

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "User", value: `${data.username} (<@${data.discordId}>)`, inline: true },
    { name: "Discord ID", value: data.discordId, inline: true },
    { name: "Type", value: typeLabel, inline: true },
    { name: "Method", value: methodLabel, inline: true },
    { name: "Amount Paid", value: amountLabel, inline: true },
  ];

  if (purchaseType === "slot" && data.slotNumber != null) {
    fields.push({ name: "Slot #", value: String(data.slotNumber), inline: true });
  }

  if (purchaseType === "slot" && data.durationHours != null) {
    const h = data.durationHours;
    const durationLabel = h >= 24
      ? `${Math.floor(h / 24)}d ${h % 24 > 0 ? `${h % 24}h` : ""}`.trim()
      : `${h}h`;
    fields.push({ name: "Duration", value: durationLabel, inline: true });
  }

  if (purchaseType === "slot" && data.expiresAt != null) {
    const ts = Math.floor(data.expiresAt.getTime() / 1000);
    fields.push({ name: "Expires", value: `<t:${ts}:F> (<t:${ts}:R>)`, inline: false });
  }

  const payload = {
    embeds: [
      {
        title,
        color,
        fields,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[discord webhook] failed ${res.status}: ${text}`);
    }
  } catch (err) {
    console.error("[discord webhook] fetch error:", err);
  }
}
