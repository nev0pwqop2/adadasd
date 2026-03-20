import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import slotsRouter from "./slots.js";
import paymentsRouter from "./payments.js";
import adminRouter from "./admin.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/slots", slotsRouter);
router.use("/payments", paymentsRouter);
router.use("/admin", adminRouter);

export default router;
