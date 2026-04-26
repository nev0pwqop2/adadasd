import { Router } from "express";
import { db, usersTable, referralsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    let [user] = await db.select({ referralCode: usersTable.referralCode }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "not_found" }); return; }

    if (!user.referralCode) {
      const newCode = generateReferralCode();
      await db.update(usersTable).set({ referralCode: newCode } as any).where(eq(usersTable.id, userId));
      user = { referralCode: newCode };
    }

    const rows = await db
      .select({ rewardCredited: referralsTable.rewardCredited, createdAt: referralsTable.createdAt })
      .from(referralsTable)
      .where(eq(referralsTable.referrerId, userId));

    const totalInvites = rows.length;
    const credited = rows.filter(r => r.rewardCredited).length;
    const pendingCredits = Math.floor(totalInvites / 10) - Math.floor(credited / 10);

    res.json({
      referralCode: user.referralCode,
      totalInvites,
      dollarsEarned: Math.floor(totalInvites / 10),
      pendingCredits,
    });
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;
