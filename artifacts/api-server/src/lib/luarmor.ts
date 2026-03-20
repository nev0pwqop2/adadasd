const LUARMOR_BASE = "https://luarmor.net/api/v3";

interface LuarmorUser {
  id: string;
  key: string;
  identifier: string;
  note?: string;
  discord_id?: string;
  expiry?: string | null;
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

export async function createLuarmorUser(discordId: string, username: string): Promise<LuarmorUser> {
  const config = getConfig();
  if (!config) throw new Error("Luarmor not configured");
  return request<LuarmorUser>(`/projects/${config.projectId}/users`, {
    method: "POST",
    body: JSON.stringify({
      identifier: discordId,
      note: username,
      discord_id: discordId,
    }),
  });
}

export async function deleteLuarmorUser(luarmorUserId: string): Promise<void> {
  const config = getConfig();
  if (!config) throw new Error("Luarmor not configured");
  await request(`/projects/${config.projectId}/users/${luarmorUserId}`, {
    method: "DELETE",
  });
}

export async function getLuarmorUsers(): Promise<LuarmorUser[]> {
  const config = getConfig();
  if (!config) throw new Error("Luarmor not configured");
  return request<LuarmorUser[]>(`/projects/${config.projectId}/users`);
}
