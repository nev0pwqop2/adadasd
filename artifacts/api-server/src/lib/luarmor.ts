const LUARMOR_BASE = "https://api.luarmor.net/v3";

export interface LuarmorUser {
  user_key: string;
  identifier: string;
  discord_id: string;
  note: string;
  auth_expire: number;
  banned: number;
  status: string;
}

function getConfig(): { apiKey: string; projectId: string } | null {
  const apiKey = process.env.LUARMOR_API_KEY;
  const projectId = process.env.LUARMOR_PROJECT_ID;
  if (!apiKey || !projectId) return null;
  return { apiKey, projectId };
}

export function isLuarmorConfigured(): boolean {
  return getConfig() !== null;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const config = getConfig();
  if (!config) throw new Error("Luarmor not configured");

  const res = await fetch(`${LUARMOR_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: config.apiKey,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Luarmor error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

export async function createLuarmorUser(
  discordId: string,
  username: string,
  expiresAt?: Date
): Promise<{ user_key: string }> {
  const config = getConfig();
  if (!config) throw new Error("Luarmor not configured");

  const body: Record<string, unknown> = {
    discord_id: discordId,
    note: username,
  };

  if (expiresAt) {
    body.auth_expire = Math.floor(expiresAt.getTime() / 1000);
  }

  try {
    return await request<{ user_key: string }>(`/projects/${config.projectId}/users`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (err) {
    // If creation failed, the user may already exist in Luarmor (same discord_id).
    // Try to find them by discord_id and update their expiry instead.
    const errMsg = err instanceof Error ? err.message : String(err);
    const existingUsers = await getLuarmorUsers();
    const existing = existingUsers.find((u) => u.discord_id === discordId);
    if (existing) {
      if (expiresAt) {
        await updateLuarmorUser(existing.user_key, {
          auth_expire: Math.floor(expiresAt.getTime() / 1000),
          note: username,
        });
      }
      return { user_key: existing.user_key };
    }
    throw new Error(`Luarmor user creation failed and no existing user found: ${errMsg}`);
  }
}

export async function deleteLuarmorUser(userKey: string): Promise<void> {
  const config = getConfig();
  if (!config) throw new Error("Luarmor not configured");
  await request(`/projects/${config.projectId}/users?user_key=${encodeURIComponent(userKey)}`, {
    method: "DELETE",
  });
}

export async function updateLuarmorUser(
  userKey: string,
  updates: { auth_expire?: number; note?: string; discord_id?: string }
): Promise<void> {
  const config = getConfig();
  if (!config) throw new Error("Luarmor not configured");
  await request(`/projects/${config.projectId}/users`, {
    method: "PATCH",
    body: JSON.stringify({ user_key: userKey, ...updates }),
  });
}

export async function resetLuarmorHwid(userKey: string): Promise<{ success: boolean; message?: string }> {
  const config = getConfig();
  if (!config) throw new Error("Luarmor not configured");
  const res = await fetch(`${LUARMOR_BASE}/projects/${config.projectId}/users/resethwid`, {
    method: "POST",
    headers: {
      Authorization: config.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_key: userKey }),
  });
  const data = await res.json() as { success: boolean; message?: string };
  if (!res.ok && !data.success) {
    throw new Error(data.message ?? `Luarmor HWID reset failed (${res.status})`);
  }
  return data;
}

/**
 * Pause a Luarmor user by setting auth_expire to 1 (epoch start = already expired).
 * Call unpauseLuarmorUser to restore.
 */
export async function pauseLuarmorUser(userKey: string): Promise<void> {
  await updateLuarmorUser(userKey, { auth_expire: 1 });
}

/**
 * Unpause a Luarmor user by restoring their real auth_expire timestamp.
 */
export async function unpauseLuarmorUser(userKey: string, expiresAt: Date): Promise<void> {
  await updateLuarmorUser(userKey, { auth_expire: Math.floor(expiresAt.getTime() / 1000) });
}

export async function getLuarmorUsers(): Promise<LuarmorUser[]> {
  const config = getConfig();
  if (!config) throw new Error("Luarmor not configured");
  const data = await request<{ success: boolean; users: LuarmorUser[] }>(
    `/projects/${config.projectId}/users`
  );
  return data.users ?? [];
}
