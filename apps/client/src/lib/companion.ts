import { API_BASE } from "./api";
import { m } from "../i18n";

export type CompanionFrequency = "rare" | "normal";

export interface CompanionSettings {
  enabled: boolean;
  frequency: CompanionFrequency;
  quiet: { start: string; end: string };
}

export type CompanionSettingsPatch = Partial<Omit<CompanionSettings, "quiet">> & { quiet?: Partial<CompanionSettings["quiet"]> };

export async function getCompanionSettings(): Promise<CompanionSettings> {
  const response = await fetch(`${API_BASE}/api/companion/settings`);
  if (!response.ok) throw new Error(m.chat.api.companionLoadFailed(response.status));
  return await response.json() as CompanionSettings;
}

export async function putCompanionSettings(patch: CompanionSettingsPatch): Promise<CompanionSettings> {
  const response = await fetch(`${API_BASE}/api/companion/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(body.message ?? m.chat.api.companionSaveFailed(response.status));
  return body as CompanionSettings;
}
