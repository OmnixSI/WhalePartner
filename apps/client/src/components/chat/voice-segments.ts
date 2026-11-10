export interface SpeechSegment {
  text: string;
  turnId: string;
  segmentIndex: number;
  emotion: string;
  characterId: string;
}

export function createSpeechSegment(
  text: string,
  turnId: string,
  segmentIndex: number,
  emotion: string,
  characterId: string,
): SpeechSegment | null {
  const content = text.trim();
  return content ? { text: content, turnId, segmentIndex, emotion, characterId } : null;
}
