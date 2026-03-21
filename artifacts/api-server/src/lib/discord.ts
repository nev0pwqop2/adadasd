export type PurchaseType = "slot" | "balance_deposit" | "preorder";

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
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
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
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Webhook failure should never block payment processing
  }
}
