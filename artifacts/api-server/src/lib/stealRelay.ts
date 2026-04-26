import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { logger } from "./logger.js";

const WEBHOOK_URL = process.env.STEAL_WEBHOOK_URL ?? "";
const STEAL_WS_PATH = "/ws/steal";

async function forwardToDiscord(payload: {
  brainrotName: string;
  moneyPerSec: string;
  imageUrl?: string | null;
  discordId?: string | null;
}) {
  if (!WEBHOOK_URL) {
    logger.warn("STEAL_WEBHOOK_URL not set — skipping Discord forward");
    return;
  }

  const { brainrotName, moneyPerSec, imageUrl, discordId, timestamp } = payload;
  const ping = discordId && discordId !== "unknown" ? `<@${discordId}>` : "N/A";
  const unixTs = timestamp ? Math.floor(new Date(timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000);

  const embed: Record<string, any> = {
    title: "Steal Successful",
    color: 0xffff00,
    description: `**Player**\n${ping}`,
    fields: [
      { name: "Brainrot", value: String(brainrotName), inline: true },
      { name: "Value",    value: String(moneyPerSec),  inline: true },
    ],
    footer: { text: `Exe Notifier • <t:${unixTs}:f>` },
  };

  if (imageUrl) embed.thumbnail = { url: imageUrl };

  const body = JSON.stringify({
    username: "EXE Notifier",
    content: discordId && discordId !== "unknown" ? `<@${discordId}>` : undefined,
    embeds: [embed],
  });

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, text }, "Discord webhook error");
    }
  } catch (err) {
    logger.warn({ err }, "Failed to forward steal to Discord");
  }
}

export function attachStealRelay(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  // Only upgrade connections on /ws/steal
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== STEAL_WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket as any, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", async (raw) => {
      let payload: any;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const { brainrotName, moneyPerSec, imageUrl, discordId } = payload;
      if (!brainrotName || !moneyPerSec) return;

      // Fire immediately — no await needed from caller's perspective
      forwardToDiscord({ brainrotName, moneyPerSec, imageUrl, discordId });
    });

    ws.on("error", (err) => logger.warn({ err }, "Steal relay WS error"));
  });

  logger.info({ path: STEAL_WS_PATH }, "Steal relay WebSocket attached");
}
