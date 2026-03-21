export async function sendPaymentWebhook(data: {
  username: string;
  discordId: string;
  method: string;
  currency?: string | null;
  amount?: string | null;
  slotNumber: number;
}): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const methodLabel = data.method === "stripe" ? "Card (Stripe)" : `Crypto (${data.currency ?? "?"})`;
  const amountLabel = data.amount ? `$${parseFloat(data.amount).toFixed(2)}` : "—";

  const payload = {
    embeds: [
      {
        title: "💰 New Slot Purchase",
        color: 0x00ff88,
        fields: [
          { name: "User", value: `${data.username} (<@${data.discordId}>)`, inline: true },
          { name: "Discord ID", value: data.discordId, inline: true },
          { name: "Slot #", value: String(data.slotNumber), inline: true },
          { name: "Method", value: methodLabel, inline: true },
          { name: "Amount", value: amountLabel, inline: true },
          { name: "Type", value: "Deposit", inline: true },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Webhook failure should never block slot activation
  }
}
