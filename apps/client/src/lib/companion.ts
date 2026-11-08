import { API_BASE } from "./api";

export type CompanionFrequency = "rare" | "normal";

export interface CompanionSettings {
  enabled: boolean;
  frequency: CompanionFrequency;
  quiet: { start: string; end: string };
}

export type CompanionSettingsPatch = Partial<Omit<CompanionSettings, "quiet">> & { quiet?: Partial<CompanionSettings["quiet"]> };

export async function getCompanionSettings(): Promise<CompanionSettings> {
  const response = await fetch(`${API_BASE}/api/companion/settings`);
  if (!response.ok) throw new Error(`读取主动陪伴设置失败（HTTP ${response.status}）。`);
  return await response.json() as CompanionSettings;
}

export async function putCompanionSettings(patch: CompanionSettingsPatch): Promise<CompanionSettings> {
  const response = await fetch(`${API_BASE}/api/companion/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(body.message ?? `保存主动陪伴设置失败（HTTP ${response.status}）。`);
  return body as CompanionSettings;
}
