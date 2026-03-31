import { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const adminProbeAttempts = new Map<string, { count: number; firstSeen: number }>();
const PROBE_BAN_WINDOW_MS = 10 * 60 * 1000;
const PROBE_ALERT_THRESHOLD = 3;

async function alertAdminProbe(ip: string, discordId: string | undefined, url: string, count: number) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "🚨 Admin Route Probe Detected",
          color: 0xff4400,
          fields: [
            { name: "IP Address", value: `\`${ip}\``, inline: true },
            { name: "Attempt #", value: String(count), inline: true },
            { name: "Discord ID", value: discordId ? `\`${discordId}\`` : "Not logged in", inline: true },
            { name: "Route", value: `\`${url}\``, inline: false },
          ],
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch {}
}

export const SUPER_ADMIN_DISCORD_ID = "905033435817586749";

const SUPER_ADMIN_IDS = new Set([
  "905033435817586749",
  "1279091875378368595",
  "1411024429365989456",
  "1485902008601804900",
  "633039714160738342",
  "335796369921015808",
]);

export function isSuperAdmin(discordId: string): boolean {
  return SUPER_ADMIN_IDS.has(discordId);
}

export async function isAdminDiscordId(discordId: string): Promise<boolean> {
  if (SUPER_ADMIN_IDS.has(discordId)) return true;
  const rows = await db
    .select({ isAdmin: usersTable.isAdmin })
    .from(usersTable)
    .where(eq(usersTable.discordId, discordId))
    .limit(1);
  return rows.length > 0 && rows[0].isAdmin;
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.session?.userId || !req.session?.discordId) {
    res
      .status(401)
      .json({ error: "unauthorized", message: "Authentication required" });
    return;
  }

  try {
    // Fetch the user row and cross-verify session userId matches the discordId in DB
    const rows = await db
      .select({
        id: usersTable.id,
        discordId: usersTable.discordId,
        isAdmin: usersTable.isAdmin,
        isBanned: usersTable.isBanned,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.session.userId))
      .limit(1);

    if (!rows.length) {
      req.session.destroy(() => {});
      res
        .status(401)
        .json({ error: "unauthorized", message: "User not found" });
      return;
    }

    const user = rows[0];

    // Ensure the session discordId actually matches what's in the DB
    if (user.discordId !== req.session.discordId) {
      req.session.destroy(() => {});
      res
        .status(401)
        .json({ error: "unauthorized", message: "Session mismatch" });
      return;
    }

    // Block banned users
    if (user.isBanned) {
      res
        .status(403)
        .json({ error: "forbidden", message: "Account is banned" });
      return;
    }

    // Check admin status from DB (super admins bypass DB flag)
    const isAdmin = SUPER_ADMIN_IDS.has(user.discordId) || user.isAdmin;
    if (!isAdmin) {
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
      const now = Date.now();
      const entry = adminProbeAttempts.get(ip) ?? { count: 0, firstSeen: now };
      if (now - entry.firstSeen > PROBE_BAN_WINDOW_MS) { entry.count = 0; entry.firstSeen = now; }
      entry.count++;
      adminProbeAttempts.set(ip, entry);

      if (entry.count >= PROBE_ALERT_THRESHOLD) {
        await alertAdminProbe(ip, user.discordId, req.originalUrl, entry.count);
      }

      res.status(403).json({
        error: "forbidden",
        message: entry.count >= PROBE_ALERT_THRESHOLD
          ? "Nice try. Your IP has been flagged and we've been alerted."
          : "Admin access required.",
      });
      return;
    }

    next();
  } catch (err) {
    res.status(500).json({
      error: "server_error",
      message: "Failed to verify admin access",
    });
  }
}
