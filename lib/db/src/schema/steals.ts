import { pgTable, serial, text, numeric, timestamp, index } from "drizzle-orm/pg-core";

export const stealsTable = pgTable("steals", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").notNull(),
  brainrotName: text("brainrot_name").notNull(),
  moneyPerSec: numeric("money_per_sec", { precision: 20, scale: 2 }).notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  discordIdIdx: index("steals_discord_id_idx").on(t.discordId),
}));

export type Steal = typeof stealsTable.$inferSelect;
