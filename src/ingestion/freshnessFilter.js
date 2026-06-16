const MOCK_HOSTS = new Set([
  "mock-public-news.example",
  "mock-rss-feed.example",
  "example.test",
  "hermes.local"
]);

const STALE_MARKERS = [
  /\b2024\b/i,
  /\b2025\b/i,
  /\blast year\b/i,
  /\byears ago\b/i,
  /\barchive\b/i,
  /\bupdated:/i,
  /\boriginally published\b/i,
  /\bfirst published\b/i,
  /\brevised\b/i,
  /\bcorrection\b/i,
  /\bfrom the archive\b/i
];

function candidateText(candidate) {
  return `${candidate?.title || candidate?.topic || ""} ${candidate?.summary || ""}`;
}

function hostnameFrom(value = "") {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return String(value || "").toLowerCase();
  }
}

export function isMockSource(candidate) {
  const values = [
    candidate?.source,
    candidate?.url,
    candidate?.rawData?.source,
    candidate?.rawData?.url
  ].filter(Boolean);
  return values.some((value) => {
    const host = hostnameFrom(value);
    return [...MOCK_HOSTS].some((mockHost) => host === mockHost || host.includes(mockHost));
  });
}

export function hasStaleContentMarker(candidate) {
  const text = candidateText(candidate);
  return STALE_MARKERS.some((marker) => marker.test(text));
}

export function candidateFreshnessReason(candidate, options = {}) {
  const {
    now = new Date(),
    maxAgeHours = 72,
    allowMissingPublishedAt = false,
    allowMockSources = false,
    rejectUpdatedOldContent = true
  } = options;

  if (!allowMockSources && isMockSource(candidate)) return "mock";
  if (candidate?.rawData?.hasPublishedAt === false) return allowMissingPublishedAt ? "fresh" : "missingDate";
  if (!candidate?.publishedAt) return allowMissingPublishedAt ? "fresh" : "missingDate";

  const publishedAt = new Date(candidate.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) return allowMissingPublishedAt ? "fresh" : "missingDate";

  const ageHours = (new Date(now).getTime() - publishedAt.getTime()) / 36e5;
  if (ageHours < 0) return "fresh";
  if (ageHours > maxAgeHours) return "stale";
  if (rejectUpdatedOldContent && hasStaleContentMarker(candidate)) return "stale";

  return "fresh";
}

export function isFreshCandidate(candidate, options = {}) {
  return candidateFreshnessReason(candidate, options) === "fresh";
}

export function filterFreshCandidates(candidates, options = {}) {
  const counts = {
    candidateCount: candidates.length,
    staleFilteredCount: 0,
    mockFilteredCount: 0,
    missingDateFilteredCount: 0,
    freshCandidateCount: 0
  };
  const freshCandidates = [];

  for (const candidate of candidates) {
    const reason = candidateFreshnessReason(candidate, options);
    if (reason === "fresh") {
      freshCandidates.push(candidate);
      counts.freshCandidateCount += 1;
    } else if (reason === "mock") {
      counts.mockFilteredCount += 1;
    } else if (reason === "missingDate") {
      counts.missingDateFilteredCount += 1;
    } else {
      counts.staleFilteredCount += 1;
    }
  }

  return { freshCandidates, counts };
}

export { MOCK_HOSTS, STALE_MARKERS };
