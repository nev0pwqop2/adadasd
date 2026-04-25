import { pgTable, serial, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const referralsTable = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: varchar("referrer_id", { length: 36 }).notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  referredId: varchar("referred_id", { length: 36 }).notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  rewardCredited: boolean("reward_credited").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Referral = typeof referralsTable.$inferSelect;
