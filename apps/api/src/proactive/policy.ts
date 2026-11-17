import { inQuietHours } from "../surf/settings.ts";
import { msg } from "../i18n/index.ts";

export type CompanionFrequency = "rare" | "normal";

export interface CompanionSettings {
  enabled: boolean;
  frequency: CompanionFrequency;
  quiet: { start: string; end: string };
}

export interface CompanionSettingsPatch {
  enabled?: boolean;
  frequency?: CompanionFrequency;
  quiet?: { start?: string; end?: string };
}

export const PROACTIVE_DELAY_MS = 20 * 60_000;
export const PROACTIVE_EXPIRY_MS = 6 * 60 * 60_000;
export const PROACTIVE_LATE_GRACE_MS = 5 * 60_000;
export const PROACTIVE_IDLE_MS = 25 * 60_000;
export const PROACTIVE_BUSY_RETRY_MS = 10 * 60_000;
export const PROACTIVE_MAX_ATTEMPTS = 2;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/u;

export class CompanionSettingsError extends Error {}

export function validateCompanionSettingsPatch(body: Record<string, unknown>): CompanionSettingsPatch {
  const patch: CompanionSettingsPatch = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") throw new CompanionSettingsError(msg().content.proactive.enabledBool);
    patch.enabled = body.enabled;
  }
  if (body.frequency !== undefined) {
    if (body.frequency !== "rare" && body.frequency !== "normal") throw new CompanionSettingsError(msg().content.proactive.frequency);
    patch.frequency = body.frequency;
  }
  if (body.quiet !== undefined) {
    if (!body.quiet || typeof body.quiet !== "object" || Array.isArray(body.quiet)) throw new CompanionSettingsError(msg().content.proactive.quietNeedsBoth);
    const quiet = body.quiet as Record<string, unknown>;
    if (quiet.start === undefined && quiet.end === undefined) throw new CompanionSettingsError(msg().content.proactive.quietNeedsBoth);
    if (quiet.start !== undefined && (typeof quiet.start !== "string" || !CLOCK.test(quiet.start))) throw new CompanionSettingsError(msg().content.proactive.startFormat);
    if (quiet.end !== undefined && (typeof quiet.end !== "string" || !CLOCK.test(quiet.end))) throw new CompanionSettingsError(msg().content.proactive.endFormat);
    patch.quiet = {
      ...(quiet.start === undefined ? {} : { start: quiet.start as string }),
      ...(quiet.end === undefined ? {} : { end: quiet.end as string }),
    };
  }
  return patch;
}

export function frequencyLimit(frequency: CompanionFrequency) {
  return frequency === "rare"
    ? { daily: 1, cooldownMs: 18 * 60 * 60_000 }
    : { daily: 2, cooldownMs: 6 * 60 * 60_000 };
}

export function nextQuietEnd(quiet: CompanionSettings["quiet"], now: Date): Date {
  const minute = now.getHours() * 60 + now.getMinutes();
  const at = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const start = at(quiet.start);
  const end = at(quiet.end);
  const next = new Date(now);
  next.setSeconds(0, 0);
  if (start === end || !inQuietHours(quiet, now)) return next;
  next.setHours(Math.floor(end / 60), end % 60, 0, 0);
  if (start > end && minute >= start) next.setDate(next.getDate() + 1);
  return next;
}

export function nextLocalDay(now: Date): Date {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next;
}

export function normalizedProactiveText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}
