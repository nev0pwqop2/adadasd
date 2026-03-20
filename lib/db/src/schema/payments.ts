import { pgTable, text, integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const paymentsTable = pgTable("payments", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  slotNumber: integer("slot_number").notNull(),
  method: text("method").notNull(),
  status: text("status").notNull().default("pending"),
  currency: text("currency"),
  amount: text("amount"),
  address: text("address"),
  txHash: text("tx_hash"),
  derivationIndex: integer("derivation_index"),
  stripeSessionId: text("stripe_session_id"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
