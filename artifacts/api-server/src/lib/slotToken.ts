import crypto from "crypto";

/**
 * Generates a cryptographic purchase token for a slot activation.
 *
 * The token is an HMAC-SHA256 of "userId:slotNumber:purchasedAt(ms)"
 * keyed with SLOT_TOKEN_SECRET.  Storing this on the slot row means
 * a row inserted directly into the database — without going through
 * any payment flow — will have a null or incorrect token and can be
 * flagged immediately.
 *
 * Returns null if SLOT_TOKEN_SECRET is not configured (token feature
 * disabled; existing slots are treated as unverified but not blocked).
 */
export function generateSlotToken(
  userId: string,
  slotNumber: number,
  purchasedAt: Date
): string | null {
  const secret = process.env.SLOT_TOKEN_SECRET;
  if (!secret) return null;
  const payload = `${userId}:${slotNumber}:${purchasedAt.getTime()}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Verifies a stored purchase token against the known slot fields.
 * Returns:
 *   "valid"    — token matches (slot was legitimately activated)
 *   "invalid"  — token is present but does not match (FORGED ROW)
 *   "missing"  — no token stored (legacy slot or secret not configured)
 */
export function verifySlotToken(
  storedToken: string | null | undefined,
  userId: string,
  slotNumber: number,
  purchasedAt: Date | null | undefined
): "valid" | "invalid" | "missing" {
  const secret = process.env.SLOT_TOKEN_SECRET;
  if (!secret || !storedToken || !purchasedAt) return "missing";

  const expected = generateSlotToken(userId, slotNumber, purchasedAt);
  if (!expected) return "missing";

  try {
    const match = crypto.timingSafeEqual(
      Buffer.from(storedToken, "hex"),
      Buffer.from(expected, "hex")
    );
    return match ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}
