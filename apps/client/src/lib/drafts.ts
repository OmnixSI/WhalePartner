/** 草稿按会话持久化（localStorage）。 */
const PREFIX = "wp.draft.";

export const draftKey = (characterId: string, sessionId: string) => `${PREFIX}${characterId}.${sessionId || "new"}`;

export function loadDraft(key: string): string {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}

export function saveDraft(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* 隐私模式 */ }
}
