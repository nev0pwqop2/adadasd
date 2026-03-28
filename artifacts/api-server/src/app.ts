import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import path from "path";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { sessionMiddleware } from "./lib/session.js";

const app: Express = express();

app.set("trust proxy", 1);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS — only allow requests from the actual frontend domain
const ALLOWED_ORIGINS = [
  "https://exenotifier.com",
  "https://www.exenotifier.com",
  // Allow Replit dev domain during development
  ...(process.env.REPLIT_DEV_DOMAIN ? [`https://${process.env.REPLIT_DEV_DOMAIN}`] : []),
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, Postman)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many requests. Please slow down." },
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Key by user ID so limits are per-account; unauthenticated requests share one bucket
  keyGenerator: (req) => (req.session as any)?.userId ?? "unauthenticated",
  validate: { xForwardedForHeader: false },
  message: { error: "too_many_requests", message: "Too many payment requests. Please slow down." },
});

const balanceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.session as any)?.userId ?? "unauthenticated",
  validate: { xForwardedForHeader: false },
  message: { error: "too_many_requests", message: "Too many requests. Please slow down." },
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many requests. Please slow down." },
});

app.use(cookieParser());
app.use(sessionMiddleware);

// Raw body required before JSON parser for webhook signature verification
app.use("/api/payments/stripe-webhook", express.raw({ type: "application/json" }));
app.use("/api/payments/nowpayments-ipn", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Apply rate limiters to specific route groups
app.use("/api/auth", authLimiter);
app.use("/api/payments/nowpayments", paymentLimiter);
app.use("/api/payments/stripe", paymentLimiter);
app.use("/api/balance", balanceLimiter);
app.use("/api/bids", balanceLimiter);
app.use("/api", strictLimiter);

app.use("/api", router);

// Serve frontend static files in production
if (process.env.NODE_ENV === "production") {
  const frontendDist = path.resolve(process.cwd(), "artifacts/exe-joiner/dist/public");
  app.use(express.static(frontendDist));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

export default app;
