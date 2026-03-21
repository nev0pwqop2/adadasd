import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const DEFAULTS: Record<string, string> = {
  slotCount: "10",
  pricePerDay: "20.00",
  slotDurationHours: "24",
  hourlyPricingEnabled: "false",
  pricePerHour: "5.00",
  minHours: "2",
  ownWalletLTC: "LRipFjnvu2tcHdasX7iALXMdEJbE9jpNNQ",
};

export async function getSetting(key: string): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
  if (rows.length > 0) return rows[0].value;
  return DEFAULTS[key as keyof typeof DEFAULTS] ?? "";
}

export async function getSettings(): Promise<{
  slotCount: number;
  pricePerDay: number;
  slotDurationHours: number;
  hourlyPricingEnabled: boolean;
  pricePerHour: number;
  minHours: number;
  ownWalletLTC: string;
}> {
  const rows = await db.select().from(settingsTable);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const g = (key: keyof typeof DEFAULTS) => map[key] ?? DEFAULTS[key] ?? "";
  return {
    slotCount: parseInt(g("slotCount"), 10),
    pricePerDay: parseFloat(g("pricePerDay")),
    slotDurationHours: parseInt(g("slotDurationHours"), 10),
    hourlyPricingEnabled: g("hourlyPricingEnabled") === "true",
    pricePerHour: parseFloat(g("pricePerHour")),
    minHours: parseInt(g("minHours"), 10),
    ownWalletLTC: g("ownWalletLTC"),
  };
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}
