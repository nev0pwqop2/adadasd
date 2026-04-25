import { Router } from "express";
import { db, reviewsTable, usersTable, paymentsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

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

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const rows = await db
      .select({ id: reviewsTable.id, rating: reviewsTable.rating, body: reviewsTable.body, isVisible: reviewsTable.isVisible })
      .from(reviewsTable)
      .where(eq(reviewsTable.userId, userId))
      .limit(1);
    res.json({ review: rows[0] ?? null });
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const { rating, body } = req.body as { rating?: number; body?: string };

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

    const existing = await db
      .select({ id: reviewsTable.id })
      .from(reviewsTable)
      .where(eq(reviewsTable.userId, userId))
      .limit(1);
    if (existing.length > 0) {
      res.status(400).json({ message: "You've already left a review" });
      return;
    }

    const completedPayment = await db
      .select({ id: paymentsTable.id })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.status, "completed")))
      .limit(1);
    if (!completedPayment.length) {
      res.status(403).json({ message: "You need to have purchased a slot to leave a review" });
      return;
    }

    await db.insert(reviewsTable).values({
      userId,
      rating,
      body: body.trim(),
      isVisible: false,
    });

    res.json({ success: true, message: "Review submitted — it'll be shown once approved" });
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;
