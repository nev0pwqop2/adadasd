import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "../middlewares/requireAuth.js";
import { isAdminDiscordId } from "../middlewares/requireAdmin.js";

const router = Router();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET!;

function getBaseUrl(): string {
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return process.env.BASE_URL || "http://localhost:80";
}

function getRedirectUri(): string {
  return `${getBaseUrl()}/api/auth/discord/callback`;
}

router.get("/discord", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: "identify email",
    state,
    prompt: "consent",
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

router.get("/discord/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    req.log.warn({ error }, "Discord OAuth error");
    res.redirect("/?error=discord_denied");
    return;
  }

  if (!state || state !== req.session.oauthState) {
    req.log.warn("Invalid OAuth state — possible CSRF");
    res.redirect("/?error=invalid_state");
    return;
  }

  if (!code) {
    res.redirect("/?error=no_code");
    return;
  }

  delete req.session.oauthState;

  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: getRedirectUri(),
      }),
    });

    if (!tokenResponse.ok) {
      req.log.error({ status: tokenResponse.status }, "Failed to exchange Discord token");
      res.redirect("/?error=token_exchange_failed");
      return;
    }

    const tokenData = await tokenResponse.json() as { access_token: string; token_type: string };

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` },
    });

    if (!userResponse.ok) {
      req.log.error({ status: userResponse.status }, "Failed to fetch Discord user");
      res.redirect("/?error=user_fetch_failed");
      return;
    }

    const discordUser = await userResponse.json() as {
      id: string;
      username: string;
      avatar: string | null;
      email: string | null;
      discriminator: string;
      global_name: string | null;
    };

    const displayName = discordUser.global_name || discordUser.username;

    const existingUsers = await db.select().from(usersTable).where(eq(usersTable.discordId, discordUser.id)).limit(1);

    let userId: string;
    if (existingUsers.length > 0) {
      userId = existingUsers[0].id;
      await db.update(usersTable).set({
        username: displayName,
        avatar: discordUser.avatar,
        email: discordUser.email,
        updatedAt: new Date(),
      }).where(eq(usersTable.discordId, discordUser.id));
    } else {
      userId = crypto.randomUUID();
      await db.insert(usersTable).values({
        id: userId,
        discordId: discordUser.id,
        username: displayName,
        avatar: discordUser.avatar,
        email: discordUser.email,
      });
    }

    req.session.userId = userId;
    req.session.discordId = discordUser.id;
    req.session.username = displayName;

    res.redirect("/dashboard");
  } catch (err) {
    req.log.error({ err }, "Discord OAuth callback error");
    res.redirect("/?error=server_error");
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const users = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId!)).limit(1);
    if (!users.length) {
      req.session.destroy(() => {});
      res.status(401).json({ error: "unauthorized", message: "User not found" });
      return;
    }
    const user = users[0];
    res.json({
      id: user.id,
      discordId: user.discordId,
      username: user.username,
      avatar: user.avatar,
      email: user.email,
      isAdmin: isAdminDiscordId(user.discordId),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch user");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/logout", requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      req.log.error({ err }, "Session destroy failed");
      res.status(500).json({ error: "server_error", message: "Logout failed" });
      return;
    }
    res.clearCookie("connect.sid");
    res.json({ success: true, message: "Logged out" });
  });
});

export default router;
