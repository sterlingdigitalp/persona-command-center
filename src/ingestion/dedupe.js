import { normalizeText } from "./text.js";

export function dedupeCandidates(candidates) {
  const seen = new Map();
  for (const candidate of candidates) {
    const key = candidate.url
      ? candidate.url.replace(/[?#].*$/, "").toLowerCase()
      : normalizeText(candidate.title || candidate.topic);
    if (!seen.has(key)) {
      seen.set(key, candidate);
    }
  }
  return [...seen.values()];
}
