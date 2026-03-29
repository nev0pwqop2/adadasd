import { Router } from "express";
import { db, usersTable, oauthStatesTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "../middlewares/requireAuth.js";
import { isAdminDiscordId, isSuperAdmin } from "../middlewares/requireAdmin.js";

const router = Router();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET!;

function getRedirectUri(): string {
  if (process.env.DISCORD_REDIRECT_URI) {
    return process.env.DISCORD_REDIRECT_URI;
  }
  if (process.env.RENDER_EXTERNAL_URL) {
    return `${process.env.RENDER_EXTERNAL_URL}/api/auth/discord/callback`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api/auth/discord/callback`;
  }
  return "http://localhost:80/api/auth/discord/callback";
}

router.get("/discord", async (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Clean up expired states and store new one in DB
    await db.delete(oauthStatesTable).where(lt(oauthStatesTable.expiresAt, new Date()));
    await db.insert(oauthStatesTable).values({ state, expiresAt });

    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: getRedirectUri(),
      response_type: "code",
      scope: "identify email guilds guilds.join",
      state,
      prompt: "consent",
    });

    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
  } catch (err) {
    req.log.error({ err }, "Failed to initiate Discord OAuth");
    res.redirect("/?error=server_error");
  }
});

router.get("/discord/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    req.log.warn({ error }, "Discord OAuth error");
    res.redirect("/?error=discord_denied");
    return;
  }

  if (!state) {
    req.log.warn("Missing OAuth state");
    res.redirect("/?error=invalid_state");
    return;
  }

  // Verify state from database
  const storedStates = await db.select().from(oauthStatesTable).where(eq(oauthStatesTable.state, state)).limit(1);
  if (!storedStates.length || storedStates[0].expiresAt < new Date()) {
    req.log.warn("Invalid or expired OAuth state — possible CSRF");
    res.redirect("/?error=invalid_state");
    return;
  }

  // Consume the state (delete from DB)
  await db.delete(oauthStatesTable).where(eq(oauthStatesTable.state, state));

  if (!code) {
    res.redirect("/?error=no_code");
    return;
  }

  // Use proxy for all Discord API calls if configured, to bypass IP blocks
  function discordApi(path: string): string {
    const proxy = process.env.DISCORD_TOKEN_PROXY_URL;
    if (proxy) {
      const base = proxy.replace(/\/$/, "");
      return `${base}${path}`;
    }
    return `https://discord.com/api${path}`;
  }

  try {
    const tokenResponse = await fetch(discordApi("/oauth2/token"), {
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
      const errBody = await tokenResponse.text();
      req.log.error({ status: tokenResponse.status, body: errBody, redirectUri: getRedirectUri() }, "Failed to exchange Discord token");
      if (tokenResponse.status === 429) {
        res.redirect("/?error=rate_limited");
        return;
      }
      req.log.error({ status: tokenResponse.status, body: errBody, redirectUri: getRedirectUri() }, "Token exchange failed (detail in server logs only)");
      res.redirect("/?error=token_exchange_failed");
      return;
    }

    const tokenData = await tokenResponse.json() as { access_token: string; token_type: string };

    const userResponse = await fetch(discordApi("/users/@me"), {
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

    // Fetch user's guilds (best-effort — don't fail login if this errors)
    type DiscordGuild = { id: string; name: string; icon: string | null; owner: boolean };
    let guilds: DiscordGuild[] = [];
    try {
      const guildsResponse = await fetch(discordApi("/users/@me/guilds"), {
        headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` },
      });
      if (guildsResponse.ok) {
        const raw = await guildsResponse.json() as any[];
        guilds = raw.map((g) => ({ id: g.id, name: g.name, icon: g.icon ?? null, owner: !!g.owner }));
      }
    } catch {
      req.log.warn("Failed to fetch Discord guilds — continuing without guild data");
    }

    const existingUsers = await db.select().from(usersTable).where(eq(usersTable.discordId, discordUser.id)).limit(1);

    const seedAdmin = isSuperAdmin(discordUser.id);

    let userId: string;
    if (existingUsers.length > 0) {
      userId = existingUsers[0].id;
      const updateData: Record<string, unknown> = {
        username: displayName,
        avatar: discordUser.avatar,
        email: discordUser.email,
        guilds,
        updatedAt: new Date(),
      };
      if (seedAdmin && !existingUsers[0].isAdmin) updateData.isAdmin = true;
      await db.update(usersTable).set(updateData as any).where(eq(usersTable.discordId, discordUser.id));
    } else {
      userId = crypto.randomUUID();
      await db.insert(usersTable).values({
        id: userId,
        discordId: discordUser.id,
        username: displayName,
        avatar: discordUser.avatar,
        email: discordUser.email,
        isAdmin: seedAdmin,
        guilds,
      });
    }

    // Auto-join the Discord server (best-effort — never blocks login)
    // Requires: bot in server, bot has CREATE_INSTANT_INVITE, guilds.join OAuth scope
    const guildId = process.env.DISCORD_GUILD_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (guildId && botToken) {
      try {
        const joinUrl = `https://discord.com/api/v10/guilds/${guildId}/members/${discordUser.id}`;
        req.log.info({ discordId: discordUser.id, guildId, joinUrl }, "Attempting guild join");
        const joinRes = await fetch(joinUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: tokenData.access_token }),
        });
        const joinBody = joinRes.status !== 204 ? await joinRes.text() : "(no body)";
        if (joinRes.status === 201) {
          req.log.info({ discordId: discordUser.id }, "User successfully added to guild");
        } else if (joinRes.status === 204) {
          req.log.info({ discordId: discordUser.id }, "User already in guild");
        } else {
          req.log.warn({ status: joinRes.status, body: joinBody, discordId: discordUser.id, guildId }, "Guild join failed — check bot permissions and token");
        }
      } catch (guildErr) {
        req.log.warn({ guildErr }, "Guild join request threw — continuing");
      }
    } else {
      req.log.warn({ hasGuildId: !!guildId, hasBotToken: !!botToken }, "Guild auto-join skipped — missing DISCORD_GUILD_ID or DISCORD_BOT_TOKEN env var");
    }

    // Regenerate the session ID after login to prevent session fixation attacks.
    // A pre-login session ID known to an attacker becomes worthless after this.
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        req.log.error({ regenErr }, "Session regeneration failed after login");
        res.redirect("/?error=server_error");
        return;
      }
      req.session.userId = userId;
      req.session.discordId = discordUser.id;
      req.session.username = displayName;
      req.session.save((saveErr) => {
        if (saveErr) req.log.error({ saveErr }, "Session save failed after login");
        res.redirect("/dashboard");
      });
    });
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
    if (user.isBanned) {
      req.session.destroy(() => {});
      res.status(403).json({ error: "banned", message: "Your account has been banned." });
      return;
    }
    const isAdmin = user.isAdmin || isSuperAdmin(user.discordId);
    res.json({
      id: user.id,
      discordId: user.discordId,
      username: user.username,
      avatar: user.avatar,
      email: user.email,
      isAdmin,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch user");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      req.log.error({ err }, "Session destroy failed");
    }
    res.clearCookie("connect.sid");
    res.json({ success: true, message: "Logged out" });
  });
});

export default router;
