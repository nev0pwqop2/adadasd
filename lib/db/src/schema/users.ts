import { pgTable, text, timestamp, varchar, boolean, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  discordId: varchar("discord_id", { length: 64 }).notNull().unique(),
  username: text("username").notNull(),
  avatar: text("avatar"),
  email: text("email"),
  isAdmin: boolean("is_admin").notNull().default(false),
  guilds: jsonb("guilds").$type<{ id: string; name: string; icon: string | null; owner: boolean }[]>(),
  balance: numeric("balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  isBanned: boolean("is_banned").notNull().default(false),
  bannedAt: timestamp("banned_at"),
  discordAccessToken: text("discord_access_token"),
  discordRefreshToken: text("discord_refresh_token"),
  discordTokenExpiresAt: timestamp("discord_token_expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
