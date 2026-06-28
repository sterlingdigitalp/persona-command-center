import { collectCandidatesForQuery } from "../providers/index.js";
import { generateSuggestedAngle } from "./angleEngine.js";
import { clusterCandidates } from "./cluster.js";
import { dedupeCandidates } from "./dedupe.js";
import { scoreCluster } from "./scoring.js";
import { getDefaultProviders } from "../../config/defaultProviders.js";

const MAX_EVIDENCE_URLS = 6;
const MAX_RAW_CANDIDATES = 8;

export async function collectPersonaCandidates(persona, options = {}) {
  const defaultProviders = getDefaultProviders();
  const queryConfigs = [];

  // PRIMARY: Watch List entities → one queryConfig per active monitor flag
  const entities = persona.trackedEntities || [];
  for (const sub of entities) {
    const entityName = sub.entity_name || sub.name || sub.entityId || "";
    const handle = sub.primary_x_handle || entityName;
    const priority = sub.priority || 5;

    if (sub.monitor_x) {
      queryConfigs.push({ query: handle, provider: "x", weight: priority, sourceType: "entity", entityId: sub.entityId, entityName });
    }
    if (sub.monitor_mentions) {
      queryConfigs.push({ query: handle, provider: "x", weight: Math.round(priority * 0.8), sourceType: "entity_mentions", entityId: sub.entityId, entityName });
    }
    if (sub.monitor_rss) {
      queryConfigs.push({ query: entityName, provider: "rss", weight: Math.round(priority * 0.6), sourceType: "entity", entityId: sub.entityId, entityName });
      queryConfigs.push({ query: entityName, provider: "news", weight: Math.round(priority * 0.5), sourceType: "entity", entityId: sub.entityId, entityName });
    }
    if (sub.monitor_crawl4ai) {
      queryConfigs.push({ query: entityName, provider: "crawl4ai", weight: Math.round(priority * 0.4), sourceType: "entity", entityId: sub.entityId, entityName });
    }
    if (sub.monitor_searchagent) {
      queryConfigs.push({ query: entityName, provider: "searchagent", weight: Math.round(priority * 0.3), sourceType: "entity", entityId: sub.entityId, entityName });
    }
  }

  // SECONDARY: rssTopics (Topic Monitoring — moved to Advanced section, still supported)
  const rssTopics = persona.rssTopics || [];
  for (const topic of rssTopics) {
    if (topic.is_active === false) continue;
    queryConfigs.push({
      query: topic.topic || persona.niche,
      provider: topic.provider || defaultProviders[0] || "rss",
      weight: topic.weight || 1,
      sourceType: "topic",
      feedUrl: topic.feed_url,
      feedUrls: topic.feed_urls || (topic.feed_url ? [topic.feed_url] : undefined)
    });
  }

  // TERTIARY: crawlTargets (Authoritative Sources — Advanced section)
  const crawlTargets = persona.crawlTargets || [];
  for (const target of crawlTargets) {
    queryConfigs.push({
      query: target.label || persona.niche,
      provider: "crawl4ai",
      weight: 1,
      sourceType: "crawl_target",
      url: target.url,
      notes: target.notes
    });
  }

  // FALLBACK: persona niche if no config sources exist
  if (!queryConfigs.length) {
    queryConfigs.push({ query: persona.niche, provider: defaultProviders[0] || "rss", weight: 1, sourceType: "fallback" });
  }

  const providerNames = Array.isArray(options.providerNames) && options.providerNames.length
    ? options.providerNames
    : null;

  const fetchTasks = queryConfigs.flatMap((queryConfig) => {
    const providers = providerNames || [queryConfig.provider || (defaultProviders[0] || "rss")];
    return providers.map(async (provider) => {
      const effectiveQuery = { ...queryConfig, provider };
      const queryCandidates = await collectCandidatesForQuery(persona, effectiveQuery, options);
      return queryCandidates.map((candidate) => ({
        ...candidate,
        rawData: {
          ...candidate.rawData,
          query: effectiveQuery.query,
          provider: effectiveQuery.provider,
          weight: effectiveQuery.weight || 1,
          entityName: queryConfig.entityName || null,
          entityId: queryConfig.entityId || null,
          sourceType: queryConfig.sourceType || null
        }
      }));
    });
  });

  const settled = await Promise.allSettled(fetchTasks);
  const candidates = [];
  const failures = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      candidates.push(...result.value);
    } else {
      failures.push(result.reason);
    }
  }

  if (failures.length && !options.ignoreProviderErrors) {
    throw failures[0];
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
    const rawCandidates = cluster.candidates.slice(0, MAX_RAW_CANDIDATES).map((candidate) => ({
      url: candidate.url,
      title: candidate.title,
      publishedAt: candidate.publishedAt,
      provider: candidate.provider,
      source: candidate.source
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
        providers: [...new Set(cluster.candidates.map((candidate) => candidate.provider))],
        candidates: rawCandidates
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
