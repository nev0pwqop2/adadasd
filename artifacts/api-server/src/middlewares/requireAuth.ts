import { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// In-memory ban cache — avoids a DB hit on every single request while still
// enforcing bans within 30 seconds of an admin applying one.
const banCache = new Map<string, { banned: boolean; expiresAt: number }>();

async function isBanned(userId: string): Promise<boolean> {
  const cached = banCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.banned;

  try {
    const rows = await db
      .select({ isBanned: usersTable.isBanned })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    const banned = rows.length > 0 && !!rows[0].isBanned;
    banCache.set(userId, { banned, expiresAt: Date.now() + 30_000 });
    return banned;
  } catch {
    // If DB is unreachable, allow the request through rather than locking everyone out.
    return false;
  }
}

// Call this from the ban endpoint so the cache is invalidated immediately.
export function invalidateBanCache(userId: string): void {
  banCache.delete(userId);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "unauthorized", message: "Authentication required" });
    return;
  }

  if (await isBanned(req.session.userId)) {
    req.session.destroy(() => {});
    res.status(403).json({ error: "banned", message: "Your account has been banned." });
    return;
  }

  next();
}
