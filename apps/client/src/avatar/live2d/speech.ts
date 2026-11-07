const EMOTION_MARKER = /\[\s*emotion\s*:\s*[a-z]+\s*\]/giu;

export function visibleBodyCharacterCount(value: string): number {
  let text = value.replace(EMOTION_MARKER, "").replace(/^\s+/u, "");
  text = text.replace(/\[\s*emotion\s*:[^\]]*$/iu, "");
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)|\[([^\]]+)\]\([^)]*\)/gu, (_match, imageText: string | undefined, linkText: string | undefined) => imageText ?? linkText ?? "");
  text = text.replace(/\]\([^)]*$/u, "");
  text = text.replace(/^\s{0,3}(?:#{1,6}\s*|>\s*|[-+*]\s+|\d+[.)]\s+)/gmu, "");
  text = text.replace(/`{1,3}|[*_~]|\\(?=[\\`*_{}\[\]()#+.!|>-])/gu, "");
  text = text.replace(/\|/gu, "").replace(/\s/gu, "");
  return Array.from(text).length;
}

export function addedBodyCharacters(previous: string, next: string): number {
  return Math.max(0, visibleBodyCharacterCount(next) - visibleBodyCharacterCount(previous));
}

export function speechDurationMs(characters: number): number {
  return Math.max(0, Math.floor(characters)) * 100;
}
