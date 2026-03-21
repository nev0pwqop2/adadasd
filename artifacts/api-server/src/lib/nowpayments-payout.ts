const NOWPAYMENTS_BASE = "https://api.nowpayments.io/v1";

async function getNowPaymentsJwt(): Promise<string> {
  const email = process.env.NOWPAYMENTS_EMAIL;
  const password = process.env.NOWPAYMENTS_PASSWORD;
  if (!email || !password) throw new Error("NOWPAYMENTS_EMAIL / NOWPAYMENTS_PASSWORD not configured");

  const res = await fetch(`${NOWPAYMENTS_BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NOWPayments auth failed ${res.status}: ${text}`);
  }
  const data = await res.json() as { token: string };
  return data.token;
}

export async function triggerAutoSplit(opts: {
  payCurrency: string;
  actuallyPaid: number;
  paymentId: string;
  partnerAddress: string;
  baseUrl: string;
}): Promise<{ success: boolean; error?: string }> {
  const { payCurrency, actuallyPaid, paymentId, partnerAddress, baseUrl } = opts;
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) return { success: false, error: "NOWPAYMENTS_API_KEY not configured" };
  if (!partnerAddress) return { success: false, error: "Partner wallet address not configured" };

  const halfAmount = Math.floor((actuallyPaid * 0.5) * 1e8) / 1e8;
  if (halfAmount <= 0) return { success: false, error: "Amount too small to split" };

  try {
    const jwt = await getNowPaymentsJwt();

    const res = await fetch(`${NOWPAYMENTS_BASE}/payout`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Authorization": `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ipn_callback_url: `${baseUrl}/api/payments/nowpayments-ipn`,
        withdrawals: [
          {
            address: partnerAddress,
            currency: payCurrency,
            amount: halfAmount,
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Payout API ${res.status}: ${text}` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}
