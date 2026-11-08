export type VoiceDiagnostic = {
  event: string;
  at: number;
  turnId?: string;
  [key: string]: string | number | boolean | null | undefined;
};

export function logVoiceDiagnostic(event: string, fields: Omit<VoiceDiagnostic, "event" | "at"> = {}) {
  const detail: VoiceDiagnostic = {
    event,
    at: Math.round(performance.now()),
    ...fields,
  };
  console.info("[whalepartner:voice]", JSON.stringify(detail));
  window.dispatchEvent(new CustomEvent("whalepartner:voice-diagnostic", { detail }));
}
