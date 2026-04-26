import { pgTable, serial, varchar, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { paymentsTable } from "./payments";

export const reviewsTable = pgTable("reviews", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  paymentId: varchar("payment_id", { length: 36 }).references(() => paymentsTable.id, { onDelete: "set null" }),
  rating: integer("rating").notNull(),
  body: text("body").notNull(),
  isVisible: boolean("is_visible").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Review = typeof reviewsTable.$inferSelect;
