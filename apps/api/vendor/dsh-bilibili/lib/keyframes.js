const MIN_GAP_SECONDS = 5;

function normalizeCandidate(candidate, duration) {
  const time = Number(candidate?.time);
  if (!Number.isFinite(time) || time < 0 || time >= Math.max(duration, 1)) return null;
  return { time, reason: candidate?.reason ?? "candidate", text: candidate?.text ?? "" };
}

function nearestCandidate(candidates, start, end, center, duration) {
  let best = null;
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate, duration);
    if (!normalized || normalized.time < start || normalized.time >= end) continue;
    if (!best || Math.abs(normalized.time - center) < Math.abs(best.time - center)) best = normalized;
  }
  return best;
}

function subtitleCandidates(segments, duration) {
  if (!Array.isArray(segments)) return [];
  const candidates = [];
  for (const segment of segments) {
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    const text = String(segment?.text ?? "").trim();
    const time = Number.isFinite(start) && Number.isFinite(end) && end > start ? (start + end) / 2 : start;
    const candidate = normalizeCandidate({ time, reason: "subtitle aligned", text }, duration);
    if (candidate && text) candidates.push(candidate);
  }
  return candidates;
}

/**
 * Spread frames across duration buckets, preferring scene changes and subtitle
 * segments near each bucket's center. Empty buckets use their center time.
 */
export function selectKeyframeTimestamps(segments, duration, maxFrames, extraCandidates = []) {
  const cap = Number.isInteger(maxFrames) && maxFrames > 0 ? maxFrames : 6;
  const validDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (validDuration === 0) return [];

  const targetCount = Math.min(cap, Math.max(1, Math.floor(validDuration / MIN_GAP_SECONDS)));
  const bucketWidth = validDuration / targetCount;
  const transcript = subtitleCandidates(segments, validDuration);
  const output = [];

  for (let index = 0; index < targetCount; index++) {
    const start = index * bucketWidth;
    const end = index === targetCount - 1 ? validDuration : start + bucketWidth;
    const center = (start + end) / 2;
    let candidate = nearestCandidate(extraCandidates, start, end, center, validDuration) ??
      nearestCandidate(transcript, start, end, center, validDuration);

    if (!candidate || (output.length > 0 && candidate.time - output[output.length - 1].time < MIN_GAP_SECONDS)) {
      candidate = { time: center, reason: "even interval", text: "" };
    }
    output.push(candidate);
  }

  return output;
}

/** seconds -> 'mm:ss' */
export function formatTime(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return String(Math.floor(s / 60)) + ":" + String(s % 60).padStart(2, "0");
}
