import { collectCandidatesForQuery } from "../providers/index.js";
import { generateSuggestedAngle } from "./angleEngine.js";
import { clusterCandidates } from "./cluster.js";
import { dedupeCandidates } from "./dedupe.js";
import { scoreCluster } from "./scoring.js";

// Caps applied when slicing rawCluster / evidenceUrls
const MAX_EVIDENCE_URLS = 6;
const MAX_RAW_CANDIDATES = 8;

export async function collectPersonaCandidates(persona, options = {}) {
  const queries = persona.queries?.length
    ? persona.queries
    : [{ query: persona.niche, provider: "news", weight: 1 }];

  const providerNames =
    Array.isArray(options.providerNames) && options.providerNames.length
      ? options.providerNames
      : null;

  // Build a flat list of every (queryConfig, provider) pair, then fire them ALL
  // concurrently instead of awaiting each one in a nested serial loop.
  const fetchTasks = queries.flatMap((queryConfig) => {
    const providers = providerNames || [queryConfig.provider || "news"];
    return providers.map((provider) => ({ queryConfig, provider }));
  });

  const results = await Promise.allSettled(
    fetchTasks.map(async ({ queryConfig, provider }) => {
      const effectiveQuery = { ...queryConfig, provider };
      const queryCandidates = await collectCandidatesForQuery(
        persona,
        effectiveQuery,
        options
      );
      return queryCandidates.map((candidate) => ({
        ...candidate,
        rawData: {
          ...candidate.rawData,
          query: effectiveQuery.query,
          provider: effectiveQuery.provider,
          weight: effectiveQuery.weight || 1,
        },
      }));
    })
  );

  const candidates = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      candidates.push(...result.value);
    } else if (!options.ignoreProviderErrors) {
      throw result.reason;
    }
    // When ignoreProviderErrors is true, silently skip failed feeds —
    // same contract as the original sequential version.
  }

  return candidates;
}

export async function buildSignalsForPersona(
  persona,
  recentTopics = [],
  options = {}
) {
  let candidates = await collectPersonaCandidates(persona, options);

  if (!candidates.length && options.allowFallbackMock && !options.forceMock) {
    candidates = await collectPersonaCandidates(persona, {
      ...options,
      forceMock: true,
    });
  }

  const deduped = dedupeCandidates(candidates);
  const clusters = clusterCandidates(deduped);

  const signals = clusters.map((cluster) => {
    const queryConfig = cluster.candidates[0].rawData || {
      query: persona.niche,
      weight: 1,
    };
    const scores = scoreCluster(persona, queryConfig, cluster, recentTopics);

    // Trim rawCluster candidates to metadata-only to avoid persisting full
    // RSS payloads (description, full content) nested inside every signal.
    const rawCandidates = cluster.candidates
      .slice(0, MAX_RAW_CANDIDATES)
      .map(({ url, title, publishedAt, provider, source }) => ({
        url,
        title,
        publishedAt,
        provider,
        source,
      }));

    return {
      personaId: persona.id,
      topic: cluster.topic,
      source: [...cluster.sourceSet].join(", "),
      query: queryConfig.query || persona.niche,
      firstSeenAt: cluster.publishedAt,
      lastSeenAt: new Date().toISOString(),
      ...scores,
      sourceCount: cluster.sourceCount,
      clusterId: cluster.id,
      suggestedAngle: generateSuggestedAngle(persona, cluster),
      evidenceUrls: cluster.urls.slice(0, MAX_EVIDENCE_URLS),
      rawCluster: {
        candidateCount: cluster.candidates.length,
        providers: [
          ...new Set(cluster.candidates.map((c) => c.provider)),
        ],
        candidates: rawCandidates,
      },
    };
  });

  return {
    candidates,
    deduped,
    clusters,
    signals: signals
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, options.maxSignalsPerPersona || 8),
  };
}
