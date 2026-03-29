import { Router } from "express";
import { db, couponsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

// POST /api/coupons/validate — check if a coupon code is valid and return discount info
router.post("/validate", requireAuth, async (req, res) => {
  const { code, price } = req.body as { code?: string; price?: number };

  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "missing_code", message: "Coupon code is required" });
    return;
  }

  if (!price || typeof price !== "number" || price <= 0) {
    res.status(400).json({ error: "missing_price", message: "Price is required to calculate discount" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(couponsTable)
      .where(and(eq(couponsTable.code, code.toUpperCase().trim()), eq(couponsTable.isActive, true)))
      .limit(1);

    if (!rows.length) {
      res.status(404).json({ error: "invalid_code", message: "Coupon code not found or inactive" });
      return;
    }

    const coupon = rows[0];
    const now = new Date();

    if (coupon.expiresAt && coupon.expiresAt < now) {
      res.status(400).json({ error: "expired", message: "This coupon has expired" });
      return;
    }

    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      res.status(400).json({ error: "used_up", message: "This coupon has reached its usage limit" });
      return;
    }

    const discountValue = parseFloat(coupon.discountValue);
    let discountAmount: number;
    let finalPrice: number;

    if (coupon.discountType === "percent") {
      discountAmount = parseFloat((price * (discountValue / 100)).toFixed(2));
      finalPrice = parseFloat(Math.max(0, price - discountAmount).toFixed(2));
    } else {
      discountAmount = parseFloat(Math.min(discountValue, price).toFixed(2));
      finalPrice = parseFloat(Math.max(0, price - discountAmount).toFixed(2));
    }

    res.json({
      valid: true,
      couponId: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue,
      discountAmount,
      finalPrice,
      originalPrice: price,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to validate coupon");
    res.status(500).json({ error: "server_error", message: "Failed to validate coupon" });
  }
});

export default router;
