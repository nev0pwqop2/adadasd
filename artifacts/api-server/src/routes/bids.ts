import { Router } from "express";
import { db, bidsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

// GET /api/bids — list all active bids with user info
router.get("/", requireAuth, async (req, res) => {
  try {
    const bids = await db
      .select({
        id: bidsTable.id,
        amount: bidsTable.amount,
        status: bidsTable.status,
        createdAt: bidsTable.createdAt,
        userId: bidsTable.userId,
        paidWithBalance: bidsTable.paidWithBalance,
        username: usersTable.username,
        discordId: usersTable.discordId,
        avatar: usersTable.avatar,
      })
      .from(bidsTable)
      .innerJoin(usersTable, eq(bidsTable.userId, usersTable.id))
      .where(eq(bidsTable.status, "active"))
      .orderBy(desc(bidsTable.amount), bidsTable.createdAt);

    const myBid = bids.find((b) => b.userId === req.session.userId);

    res.json({
      bids: bids.map((b) => ({
        id: b.id,
        amount: parseFloat(b.amount),
        username: b.username,
        discordId: b.discordId,
        avatar: b.avatar,
        isOwn: b.userId === req.session.userId,
        paidWithBalance: b.paidWithBalance,
        createdAt: b.createdAt.toISOString(),
      })),
      myBid: myBid
        ? {
            id: myBid.id,
            amount: parseFloat(myBid.amount),
            rank: bids.indexOf(myBid) + 1,
            paidWithBalance: myBid.paidWithBalance,
          }
        : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch bids");
    res.status(500).json({ error: "server_error", message: "Failed to fetch bids" });
  }
});

// POST /api/bids — place or update your bid
router.post("/", requireAuth, async (req, res) => {
  const { amount, useBalance } = req.body as { amount?: number; useBalance?: boolean };

  if (!amount || typeof amount !== "number" || amount <= 0) {
    res.status(400).json({ error: "invalid_amount", message: "Bid amount must be a positive number" });
    return;
  }

  if (amount > 100000) {
    res.status(400).json({ error: "invalid_amount", message: "Bid amount too large" });
    return;
  }

  const userId = req.session.userId!;

  try {
    const existing = await db
      .select()
      .from(bidsTable)
      .where(eq(bidsTable.userId, userId))
      .limit(1);

    if (useBalance) {
      // Fetch user balance
      const userRows = await db.select({ balance: usersTable.balance }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      const currentBalance = parseFloat(userRows[0]?.balance ?? "0");

      const oldBalanceHeld = existing.length && existing[0].paidWithBalance ? parseFloat(existing[0].amount) : 0;
      const netCost = amount - oldBalanceHeld;

      if (currentBalance < netCost) {
        res.status(400).json({
          error: "insufficient_balance",
          message: `Insufficient balance. Need $${netCost.toFixed(2)} more (have $${currentBalance.toFixed(2)})`,
        });
        return;
      }

      // Deduct net cost (new amount minus already-held old amount)
      if (netCost > 0) {
        await db.update(usersTable)
          .set({ balance: sql`${usersTable.balance} - ${netCost.toFixed(2)}::numeric`, updatedAt: new Date() })
          .where(eq(usersTable.id, userId));
      } else if (netCost < 0) {
        // Refund the difference if lowering a balance bid
        const refund = Math.abs(netCost);
        await db.update(usersTable)
          .set({ balance: sql`${usersTable.balance} + ${refund.toFixed(2)}::numeric`, updatedAt: new Date() })
          .where(eq(usersTable.id, userId));
      }

      if (existing.length) {
        await db
          .update(bidsTable)
          .set({ amount: amount.toFixed(2), paidWithBalance: true, updatedAt: new Date() })
          .where(eq(bidsTable.userId, userId));
        res.json({ success: true, message: "Bid updated" });
      } else {
        await db.insert(bidsTable).values({
          userId,
          amount: amount.toFixed(2),
          status: "active",
          paidWithBalance: true,
        });
        res.json({ success: true, message: "Bid placed" });
      }
    } else {
      // No balance payment — if existing bid was paid with balance, refund it first
      if (existing.length && existing[0].paidWithBalance) {
        const refundAmount = parseFloat(existing[0].amount);
        await db.update(usersTable)
          .set({ balance: sql`${usersTable.balance} + ${refundAmount.toFixed(2)}::numeric`, updatedAt: new Date() })
          .where(eq(usersTable.id, userId));
      }

      if (existing.length) {
        await db
          .update(bidsTable)
          .set({ amount: amount.toFixed(2), paidWithBalance: false, updatedAt: new Date() })
          .where(eq(bidsTable.userId, userId));
        res.json({ success: true, message: "Bid updated" });
      } else {
        await db.insert(bidsTable).values({
          userId,
          amount: amount.toFixed(2),
          status: "active",
          paidWithBalance: false,
        });
        res.json({ success: true, message: "Bid placed" });
      }
    }
  } catch (err) {
    req.log.error({ err }, "Failed to place bid");
    res.status(500).json({ error: "server_error", message: "Failed to place bid" });
  }
});

// DELETE /api/bids — cancel your bid (refunds balance if paid with balance)
router.delete("/", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  try {
    const existing = await db.select().from(bidsTable).where(eq(bidsTable.userId, userId)).limit(1);

    if (existing.length && existing[0].paidWithBalance) {
      const refundAmount = parseFloat(existing[0].amount);
      await db.update(usersTable)
        .set({ balance: sql`${usersTable.balance} + ${refundAmount.toFixed(2)}::numeric`, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));
    }

    await db.delete(bidsTable).where(eq(bidsTable.userId, userId));

    res.json({ success: true, message: "Bid cancelled" });
  } catch (err) {
    req.log.error({ err }, "Failed to cancel bid");
    res.status(500).json({ error: "server_error", message: "Failed to cancel bid" });
  }
});

export default router;
