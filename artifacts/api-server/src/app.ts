import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
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
      // Return null (not an Error) so Express sends a clean 403 CORS rejection,
      // not a 500 internal server error.
      callback(null, false);
    },
    credentials: true,
  })
);

// Returns the real client IP in a way that cannot be spoofed via X-Forwarded-For headers.
// In production (behind Render's proxy), Render always APPENDS the true source IP as the
// last comma-separated entry in X-Forwarded-For. A client can prepend fake IPs but cannot
// forge the entry that Render itself adds. We therefore take the LAST entry.
// Direct connections (no XFF) fall back to the raw socket address.
function getRealIp(req: express.Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress ?? "unknown";
}


app.use(cookieParser());
app.use(sessionMiddleware);

// Server-to-server steal record endpoint — authenticated by secret header, no CORS needed
app.use("/api/steals/record", cors());

// Raw body required before JSON parser for webhook signature verification
app.use("/api/payments/stripe-webhook", express.raw({ type: "application/json" }));
app.use("/api/payments/nowpayments-ipn", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Detect isAdmin injection attempts in request body or query string
app.use((req, _res, next) => {
  const ADMIN_INJECT_KEYS = ["isAdmin", "is_admin", "isadmin", "admin"];
  const body = req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body as Record<string, unknown> : {};
  const query = req.query as Record<string, unknown>;
  const found = ADMIN_INJECT_KEYS.find(k => k in body || k in query);
  if (found) {
    const ip = getRealIp(req);
    const discordId = req.session?.discordId ?? "not logged in";
    logger.warn({ ip, discordId, key: found, url: req.originalUrl }, "isAdmin injection attempt detected");
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            title: "🚨 isAdmin Spoof Attempt",
            color: 0xff0000,
            fields: [
              { name: "IP", value: `\`${ip}\``, inline: true },
              { name: "Discord ID", value: `\`${discordId}\``, inline: true },
              { name: "Injected Key", value: `\`${found}\``, inline: true },
              { name: "Route", value: `\`${req.method} ${req.originalUrl}\``, inline: false },
            ],
            timestamp: new Date().toISOString(),
          }],
        }),
      }).catch(() => {});
    }
    _res.status(403).json({ error: "spoof_detected", message: "you tryna spoof us, big guy?" });
    return;
  }
  next();
});

// Block prototype pollution attempts — reject any request body containing
// __proto__, constructor, or prototype keys which can poison all JS objects.
app.use((req, _res, next) => {
  const dangerousKeys = ["__proto__", "constructor", "prototype"];
  const hasDangerousKey = (obj: unknown, depth = 0): boolean => {
    if (depth > 5 || obj === null || typeof obj !== "object") return false;
    for (const key of Object.keys(obj as object)) {
      if (dangerousKeys.includes(key)) return true;
      if (hasDangerousKey((obj as Record<string, unknown>)[key], depth + 1)) return true;
    }
    return false;
  };
  if (req.body && hasDangerousKey(req.body)) {
    _res.status(400).json({ error: "invalid_input", message: "Invalid request body" });
    return;
  }
  next();
});

// HTTP Parameter Pollution — reject request bodies that contain array values.
// e.g. {"amount": [1, 99999]} could confuse parseInt/parseFloat into returning NaN
// or trick code that expects a single scalar value.
// Webhook endpoints receive raw buffers (not JSON objects) so they are excluded.
app.use((req, _res, next) => {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    const hasArray = Object.values(req.body as object).some((v) => Array.isArray(v));
    if (hasArray) {
      _res.status(400).json({ error: "invalid_input", message: "Invalid request body" });
      return;
    }
  }
  next();
});

// Prevent API responses from being cached by browsers or CDNs.
// Stale cached responses could expose data to unintended parties.
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
});

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
