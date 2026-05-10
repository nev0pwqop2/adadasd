import { Router } from "express";
import { db } from "@workspace/db";
import { stealsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

function parseMoney(raw: string): number {
  const s = String(raw).replace(/[$,\s]/g, "").toLowerCase().replace("/s", "").replace("sec", "");
  const n = parseFloat(s);
  if (isNaN(n)) return NaN;
  if (s.endsWith("b")) return n * 1e9;
  if (s.endsWith("m")) return n * 1e6;
  if (s.endsWith("k")) return n * 1e3;
  return n;
}

// POST /api/steals/record — called directly by Lua script or relay server
router.post("/record", async (req, res) => {
  const { brainrotName, moneyPerSec, imageUrl, discordId } = req.body as {
    brainrotName?: string;
    moneyPerSec?: number | string;
    imageUrl?: string | null;
    discordId?: string | null;
  };

  if (!brainrotName || !moneyPerSec) {
    res.status(400).json({ error: "missing_fields", message: "brainrotName and moneyPerSec are required" });
    return;
  }

  const safeDiscordId = (!discordId || discordId === "unknown") ? "unknown" : String(discordId);

  const numericValue = typeof moneyPerSec === "number"
    ? moneyPerSec
    : parseMoney(String(moneyPerSec));

  if (isNaN(numericValue) || numericValue <= 0) {
    res.status(400).json({ error: "invalid_value", message: `Cannot parse moneyPerSec: ${moneyPerSec}` });
    return;
  }

  try {
    await db.insert(stealsTable).values({
      discordId: safeDiscordId,
      brainrotName: String(brainrotName),
      moneyPerSec: String(numericValue),
      imageUrl: imageUrl ?? null,
    });

    logger.info({ brainrotName, numericValue, safeDiscordId }, "Join recorded via HTTP");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to record join");
    res.status(500).json({ error: "server_error" });
  }
});

// GET /api/steals/:discordId — fetch steals for a user
router.get("/:discordId", async (req, res) => {
  try {
    const steals = await db
      .select()
      .from(stealsTable)
      .where(eq(stealsTable.discordId, req.params.discordId))
      .orderBy(desc(stealsTable.moneyPerSec))
      .limit(20);

    res.json({ steals });
  } catch (err) {
    logger.error({ err }, "Failed to fetch steals");
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
