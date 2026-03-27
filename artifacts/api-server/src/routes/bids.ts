import { Router } from "express";
import { db, bidsTable, usersTable, preordersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

// GET /api/bids — list all active bids with user info + top preorder amount
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

    const topPreorderRows = await db
      .select({ amount: preordersTable.amount })
      .from(preordersTable)
      .where(eq(preordersTable.status, "paid"))
      .orderBy(desc(preordersTable.amount))
      .limit(1);
    const topPreorderAmount = topPreorderRows.length ? parseFloat(topPreorderRows[0].amount) : null;

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
      topPreorderAmount,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch bids");
    res.status(500).json({ error: "server_error", message: "Failed to fetch bids" });
  }
});

// POST /api/bids — place or raise your bid (always paid with balance)
router.post("/", requireAuth, async (req, res) => {
  const { amount } = req.body as { amount?: number };

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
    // Enforce bid must exceed the highest active pre-order
    const topPreorderRows = await db
      .select({ amount: preordersTable.amount })
      .from(preordersTable)
      .where(eq(preordersTable.status, "paid"))
      .orderBy(desc(preordersTable.amount))
      .limit(1);
    const topPreorderAmount = topPreorderRows.length ? parseFloat(topPreorderRows[0].amount) : 0;

    if (topPreorderAmount > 0 && amount <= topPreorderAmount) {
      res.status(400).json({
        error: "bid_too_low",
        message: `Your bid must exceed the highest pre-order of $${topPreorderAmount.toFixed(2)} to get priority. Bid more than $${topPreorderAmount.toFixed(2)}.`,
      });
      return;
    }

    const existing = await db
      .select()
      .from(bidsTable)
      .where(eq(bidsTable.userId, userId))
      .limit(1);

    const userRows = await db.select({ balance: usersTable.balance }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    const currentBalance = parseFloat(userRows[0]?.balance ?? "0");

    // The existing bid is always held from balance; new bid must be higher
    const alreadyHeld = existing.length ? parseFloat(existing[0].amount) : 0;

    if (existing.length && amount <= alreadyHeld) {
      res.status(400).json({ error: "bid_too_low", message: "New bid must be higher than your current bid." });
      return;
    }

    // Only deduct the difference (the rest is already held)
    const netCost = amount - alreadyHeld;

    if (currentBalance < netCost) {
      res.status(400).json({
        error: "insufficient_balance",
        message: `Insufficient balance. Need $${netCost.toFixed(2)} more (you have $${currentBalance.toFixed(2)}).`,
      });
      return;
    }

    // Deduct the difference from balance
    if (netCost > 0) {
      await db.update(usersTable)
        .set({ balance: sql`${usersTable.balance} - ${netCost.toFixed(2)}::numeric`, updatedAt: new Date() })
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
  } catch (err) {
    req.log.error({ err }, "Failed to place bid");
    res.status(500).json({ error: "server_error", message: "Failed to place bid" });
  }
});

// DELETE /api/bids — cancel your bid (always refunds balance)
router.delete("/", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  try {
    const existing = await db.select().from(bidsTable).where(eq(bidsTable.userId, userId)).limit(1);

    if (existing.length) {
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
