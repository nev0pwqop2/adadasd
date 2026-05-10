import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import slotsRouter from "./slots.js";
import paymentsRouter from "./payments.js";
import adminRouter from "./admin.js";
import bidsRouter from "./bids.js";
import preordersRouter from "./preorders.js";
import balanceRouter from "./balance.js";
import couponsRouter from "./coupons.js";
import reviewsRouter from "./reviews.js";
import referralsRouter from "./referrals.js";
import stealsRouter from "./steals.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/slots", slotsRouter);
router.use("/payments", paymentsRouter);
router.use("/admin", adminRouter);
router.use("/bids", bidsRouter);
router.use("/preorders", preordersRouter);
router.use("/balance", balanceRouter);
router.use("/coupons", couponsRouter);
router.use("/reviews", reviewsRouter);
router.use("/referral", referralsRouter);
router.use("/steals", stealsRouter);

export default router;
