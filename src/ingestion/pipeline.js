import { collectCandidatesForQuery } from "../providers/index.js";
import { generateSuggestedAngle } from "./angleEngine.js";
import { clusterCandidates } from "./cluster.js";
import { dedupeCandidates } from "./dedupe.js";
import { scoreCluster } from "./scoring.js";

export async function collectPersonaCandidates(persona, options = {}) {
  const candidates = [];
  const queries = persona.queries?.length ? persona.queries : [{ query: persona.niche, provider: "news", weight: 1 }];
  const providerNames = Array.isArray(options.providerNames) && options.providerNames.length
    ? options.providerNames
    : null;

  for (const queryConfig of queries) {
    const providers = providerNames || [queryConfig.provider || "news"];
    for (const provider of providers) {
      try {
        const effectiveQuery = { ...queryConfig, provider };
        const queryCandidates = await collectCandidatesForQuery(persona, effectiveQuery, options);
        candidates.push(...queryCandidates.map((candidate) => ({
          ...candidate,
          rawData: {
            ...candidate.rawData,
            query: effectiveQuery.query,
            provider: effectiveQuery.provider,
            weight: effectiveQuery.weight || 1
          }
        })));
      } catch (error) {
        if (!options.ignoreProviderErrors) throw error;
      }
    }
  }

  return candidates;
}

export async function buildSignalsForPersona(persona, recentTopics = [], options = {}) {
  let candidates = await collectPersonaCandidates(persona, options);

  if (!candidates.length && options.allowFallbackMock && !options.forceMock) {
    candidates = await collectPersonaCandidates(persona, { ...options, forceMock: true });
  }

  const deduped = dedupeCandidates(candidates);
  const clusters = clusterCandidates(deduped);
  const signals = clusters.map((cluster) => {
    const queryConfig = cluster.candidates[0].rawData || { query: persona.niche, weight: 1 };
    const scores = scoreCluster(persona, queryConfig, cluster, recentTopics);
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
      evidenceUrls: cluster.urls.slice(0, 6),
      rawCluster: {
        candidateCount: cluster.candidates.length,
        providers: [...new Set(cluster.candidates.map((candidate) => candidate.provider))],
        candidates: cluster.candidates.slice(0, 8)
      }
    };
  });

  return {
    candidates,
    deduped,
    clusters,
    signals: signals.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, options.maxSignalsPerPersona || 8)
  };
}
