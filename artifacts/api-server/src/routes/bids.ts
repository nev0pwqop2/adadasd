import { Router } from "express";
import { db, bidsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
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
        createdAt: b.createdAt.toISOString(),
      })),
      myBid: myBid
        ? { id: myBid.id, amount: parseFloat(myBid.amount), rank: bids.indexOf(myBid) + 1 }
        : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch bids");
    res.status(500).json({ error: "server_error", message: "Failed to fetch bids" });
  }
});

// POST /api/bids — place or update your bid
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

  try {
    const existing = await db
      .select()
      .from(bidsTable)
      .where(eq(bidsTable.userId, req.session.userId!))
      .limit(1);

    if (existing.length) {
      await db
        .update(bidsTable)
        .set({ amount: amount.toFixed(2), updatedAt: new Date() })
        .where(eq(bidsTable.userId, req.session.userId!));
      res.json({ success: true, message: "Bid updated" });
    } else {
      await db.insert(bidsTable).values({
        userId: req.session.userId!,
        amount: amount.toFixed(2),
        status: "active",
      });
      res.json({ success: true, message: "Bid placed" });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to place bid");
    res.status(500).json({ error: "server_error", message: "Failed to place bid" });
  }
});

// DELETE /api/bids — cancel your bid
router.delete("/", requireAuth, async (req, res) => {
  try {
    await db
      .delete(bidsTable)
      .where(eq(bidsTable.userId, req.session.userId!));

    res.json({ success: true, message: "Bid cancelled" });
  } catch (err) {
    req.log.error({ err }, "Failed to cancel bid");
    res.status(500).json({ error: "server_error", message: "Failed to cancel bid" });
  }
});

export default router;
