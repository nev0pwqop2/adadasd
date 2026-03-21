import { Request, Response, NextFunction } from "express";

const ADMIN_DISCORD_IDS = new Set([
  "905033435817586749",
  "1279091875378368595",
  "1435005690824622090",
]);

export function isAdminDiscordId(discordId: string): boolean {
  return ADMIN_DISCORD_IDS.has(discordId);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "unauthorized", message: "Authentication required" });
    return;
  }
  if (!req.session?.discordId || !ADMIN_DISCORD_IDS.has(req.session.discordId)) {
    res.status(403).json({ error: "forbidden", message: "Admin access required" });
    return;
  }
  next();
}
