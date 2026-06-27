// Provider-specific mock knowledge has been moved to src/providers/mockProvider.js
// (MOCK_HOSTS + isMockSource implementation live inside the mock provider).
// Pipeline/freshness now delegates rather than owning the list.

import { isMockSource as isMockProviderSource, MOCK_HOSTS } from "../providers/mockProvider.js";

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
  if (!candidate) return false;
  // Primary: delegate to provider-owned logic (provider === 'mock' or rawData.mock)
  if (typeof isMockProviderSource === "function") {
    const fromProvider = isMockProviderSource(candidate);
    if (fromProvider) return true;
  }
  // Fallback compat for host patterns (knowledge lives in mockProvider)
  const values = [
    candidate?.source,
    candidate?.url,
    candidate?.rawData?.source,
    candidate?.rawData?.url
  ].filter(Boolean);
  const hosts = MOCK_HOSTS || new Set();
  return values.some((value) => {
    const host = hostnameFrom(value);
    return [...hosts].some((mockHost) => host === mockHost || host.includes(mockHost));
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
  // Date validity: providers set publishedAt reliably or may flag via rawData.hasPublishedAt.
  // No RSS-specific knowledge here — any provider that fails to provide a usable date is treated the same.
  const hasReliableDate = candidate?.publishedAt && !Number.isNaN(new Date(candidate.publishedAt).getTime()) && (candidate?.rawData?.hasPublishedAt !== false);
  if (!hasReliableDate) return allowMissingPublishedAt ? "fresh" : "missingDate";

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

// Re-export for tests / legacy (MOCK_HOSTS now sourced from mockProvider via import)
export { STALE_MARKERS, MOCK_HOSTS };
