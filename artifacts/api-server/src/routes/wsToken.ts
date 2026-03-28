import { Router } from "express";
import crypto from "crypto";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = Router();

const WS_TOKEN_SECRET = process.env.WS_TOKEN_SECRET;

// POST /api/ws-token
// Issues a short-lived signed token the client must present when opening a
// WebSocket connection. Tokens expire in 30 seconds and are single-use —
// the WS server tracks which tokens have already been consumed.
//
// Flow:
//   1. Frontend calls POST /api/ws-token (must be logged in)
//   2. Gets back { token: "..." }
//   3. Connects to wss://ws.yourdomain.com?token=<token>
//   4. WS server validates signature + expiry + not-yet-used → allow
//      Any invalid/expired/reused token → destroy socket immediately
router.post("/ws-token", requireAuth, (req, res) => {
  if (!WS_TOKEN_SECRET) {
    res.status(503).json({ error: "not_configured", message: "WebSocket tokens are not configured" });
    return;
  }

  const userId    = req.session.userId!;
  const expiresAt = Date.now() + 30_000; // 30 seconds

  // Payload: userId + expiry timestamp
  const payload   = `${userId}.${expiresAt}`;
  const signature = crypto
    .createHmac("sha256", WS_TOKEN_SECRET)
    .update(payload)
    .digest("base64url");

  // Token format: <userId>.<expiresAt>.<signature>
  const token = `${payload}.${signature}`;

  res.json({ token, expiresAt });
});

export default router;
