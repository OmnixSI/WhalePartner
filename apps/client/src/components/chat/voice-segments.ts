const SENTENCE_END = /[。！？!?；;\n]/;
const CLAUSE_END = /[，,、：:]/;
const MIN_SEGMENT_LENGTH = 12;
const LONG_SEGMENT_LENGTH = 72;
const MIN_CLAUSE_LENGTH = 26;

export interface SpeechSegments {
  ready: string[];
  remainder: string;
}

function clauseBoundary(text: string): number | null {
  const clauses = [...text.matchAll(new RegExp(CLAUSE_END.source, "g"))];
  const preferred = clauses.filter((match) => {
    const end = (match.index ?? 0) + match[0].length;
    return end >= MIN_CLAUSE_LENGTH && end <= LONG_SEGMENT_LENGTH;
  });
  const boundary = preferred.at(-1) ?? clauses.find((match) => (match.index ?? 0) + match[0].length >= LONG_SEGMENT_LENGTH);
  return boundary?.index === undefined ? null : boundary.index + boundary[0].length;
}

export function takeSpeechSegments(input: string, flush = false): SpeechSegments {
  let remainder = input;
  const ready: string[] = [];

  while (remainder) {
    const sentence = SENTENCE_END.exec(remainder);
    if (sentence?.index !== undefined) {
      const end = sentence.index + sentence[0].length;
      if (end > LONG_SEGMENT_LENGTH) {
        const clauseEnd = clauseBoundary(remainder.slice(0, end));
        if (clauseEnd !== null) {
          ready.push(remainder.slice(0, clauseEnd).trim());
          remainder = remainder.slice(clauseEnd).trimStart();
          continue;
        }
      }
      if (end < MIN_SEGMENT_LENGTH && !flush) {
        const next = SENTENCE_END.exec(remainder.slice(end));
        if (next?.index === undefined) break;
        const combinedEnd = end + next.index + next[0].length;
        ready.push(remainder.slice(0, combinedEnd).trim());
        remainder = remainder.slice(combinedEnd).trimStart();
        continue;
      }
      ready.push(remainder.slice(0, end).trim());
      remainder = remainder.slice(end).trimStart();
      continue;
    }

    if (remainder.length > LONG_SEGMENT_LENGTH) {
      const end = clauseBoundary(remainder);
      if (end !== null) {
        ready.push(remainder.slice(0, end).trim());
        remainder = remainder.slice(end).trimStart();
        continue;
      }
    }
    break;
  }

  if (flush && remainder.trim()) {
    ready.push(remainder.trim());
    remainder = "";
  }

  return { ready: ready.filter(Boolean), remainder };
}
