import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const DEFAULTS = {
  slotCount: "10",
  pricePerDay: "20.00",
};

export async function getSetting(key: string): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
  if (rows.length > 0) return rows[0].value;
  return DEFAULTS[key as keyof typeof DEFAULTS] ?? "";
}

export async function getSettings(): Promise<{ slotCount: number; pricePerDay: number }> {
  const rows = await db.select().from(settingsTable);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    slotCount: parseInt(map.slotCount ?? DEFAULTS.slotCount, 10),
    pricePerDay: parseFloat(map.pricePerDay ?? DEFAULTS.pricePerDay),
  };
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}
