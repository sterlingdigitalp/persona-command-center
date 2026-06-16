const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "amid", "and", "are", "but", "for", "from", "has",
  "have", "how", "into", "its", "new", "not", "over", "said", "say", "the", "their", "this", "that",
  "with", "will", "you", "your", "was", "were", "who", "why"
]);

export function normalizeText(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function tokenize(value = "") {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

export function keywordSet(value = "") {
  return new Set(tokenize(value));
}

export function overlapScore(a, b) {
  const left = keywordSet(a);
  const right = keywordSet(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.min(left.size, right.size);
}

export function slug(value = "") {
  return normalizeText(value).split(" ").slice(0, 8).join("-");
}
