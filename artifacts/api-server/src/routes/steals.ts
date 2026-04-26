import { Router } from "express";
import { db } from "@workspace/db";
import { stealsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

const STEAL_SECRET = process.env.STEAL_RECORD_SECRET ?? "";

// POST /api/steals/record — called by the external relay server (server.js on Render)
router.post("/record", async (req, res) => {
  const secret = req.headers["x-steal-secret"];
  if (!STEAL_SECRET || secret !== STEAL_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { brainrotName, moneyPerSec, imageUrl, discordId } = req.body as {
    brainrotName?: string;
    moneyPerSec?: number | string;
    imageUrl?: string | null;
    discordId?: string | null;
  };

  if (!brainrotName || !moneyPerSec || !discordId || discordId === "unknown") {
    res.status(400).json({ error: "missing_fields" });
    return;
  }

  const numericValue = parseFloat(String(moneyPerSec));
  if (isNaN(numericValue) || numericValue <= 0) {
    res.status(400).json({ error: "invalid_value" });
    return;
  }

  try {
    await db.insert(stealsTable).values({
      discordId,
      brainrotName: String(brainrotName),
      moneyPerSec: String(numericValue),
      imageUrl: imageUrl ?? null,
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to record steal");
    res.status(500).json({ error: "server_error" });
  }
});

// GET /api/steals/:discordId — internal helper (no auth, trusted callers only)
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
