import { pgTable, serial, varchar, text, timestamp, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const preordersTable = pgTable("preorders", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  amount: text("amount").notNull(),
  currency: text("currency"),
  paymentId: varchar("payment_id", { length: 64 }),
  status: text("status").notNull().default("paid"),
  hoursRequested: integer("hours_requested"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Preorder = typeof preordersTable.$inferSelect;
