import { pgTable, text, integer, boolean, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const slotsTable = pgTable("slots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  slotNumber: integer("slot_number").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  purchasedAt: timestamp("purchased_at"),
  expiresAt: timestamp("expires_at"),
  label: text("label"),
  luarmorUserId: text("luarmor_user_id"),
  hwidResetAt: timestamp("hwid_reset_at"),
  purchaseToken: text("purchase_token"),
  notified24h: boolean("notified_24h").notNull().default(false),
  notified1h: boolean("notified_1h").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSlotSchema = createInsertSchema(slotsTable).omit({
  createdAt: true,
});
export type InsertSlot = z.infer<typeof insertSlotSchema>;
export type Slot = typeof slotsTable.$inferSelect;
