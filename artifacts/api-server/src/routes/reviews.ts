import { Router } from "express";
import { db, reviewsTable, usersTable, paymentsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

// GET /api/reviews — public list of approved reviews
router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: reviewsTable.id,
        rating: reviewsTable.rating,
        body: reviewsTable.body,
        createdAt: reviewsTable.createdAt,
        username: usersTable.username,
        avatar: usersTable.avatar,
        discordId: usersTable.discordId,
      })
      .from(reviewsTable)
      .innerJoin(usersTable, eq(reviewsTable.userId, usersTable.id))
      .where(eq(reviewsTable.isVisible, true))
      .orderBy(desc(reviewsTable.createdAt));
    res.json({ reviews: rows });
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/reviews/mine — returns map of paymentId -> review for the current user
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const rows = await db
      .select({
        id: reviewsTable.id,
        paymentId: reviewsTable.paymentId,
        rating: reviewsTable.rating,
        body: reviewsTable.body,
        isVisible: reviewsTable.isVisible,
      })
      .from(reviewsTable)
      .where(eq(reviewsTable.userId, userId));

    const byPayment: Record<string, { id: number; rating: number; body: string; isVisible: boolean }> = {};
    for (const r of rows) {
      if (r.paymentId) byPayment[r.paymentId] = { id: r.id, rating: r.rating, body: r.body, isVisible: r.isVisible };
    }
    res.json({ reviews: byPayment });
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

// POST /api/reviews — submit a review for a specific completed payment
router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const { rating, body, paymentId } = req.body as { rating?: number; body?: string; paymentId?: string };

    if (!rating || rating < 1 || rating > 5) {
      res.status(400).json({ message: "Rating must be 1–5" });
      return;
    }
    if (!body || body.trim().length < 5) {
      res.status(400).json({ message: "Review must be at least 5 characters" });
      return;
    }
    if (body.trim().length > 500) {
      res.status(400).json({ message: "Review must be under 500 characters" });
      return;
    }
    if (!paymentId) {
      res.status(400).json({ message: "paymentId is required" });
      return;
    }

    // Verify the payment belongs to this user and is completed
    const [payment] = await db
      .select({ id: paymentsTable.id })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.userId, userId), eq(paymentsTable.status, "completed")))
      .limit(1);
    if (!payment) {
      res.status(403).json({ message: "Payment not found or not completed" });
      return;
    }

    // One review per (user, payment)
    const existing = await db
      .select({ id: reviewsTable.id })
      .from(reviewsTable)
      .where(and(eq(reviewsTable.userId, userId), eq(reviewsTable.paymentId as any, paymentId)))
      .limit(1);
    if (existing.length > 0) {
      res.status(400).json({ message: "You've already reviewed this slot" });
      return;
    }

    await db.insert(reviewsTable).values({
      userId,
      paymentId,
      rating,
      body: body.trim(),
      isVisible: false,
    } as any);

    res.json({ success: true, message: "Review submitted — it'll be shown once approved" });
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;
