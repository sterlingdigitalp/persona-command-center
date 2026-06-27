import { buildSignalsForPersona } from "../ingestion/pipeline.js";
import { clusterCandidates } from "../ingestion/cluster.js";
import { dedupeCandidates } from "../ingestion/dedupe.js";
import { filterFreshCandidates } from "../ingestion/freshnessFilter.js";
import { generateSuggestedAngle } from "../ingestion/angleEngine.js";
import { scoreCluster } from "../ingestion/scoring.js";
import { getHermesAttributionDefaults } from "./hermesClient.js";
import { selectMorningDigestSignals } from "./chiefOfStaff.js";
import { listProviders, getProvider } from "../providers/index.js";
import { getDefaultProviders } from "../../config/defaultProviders.js";

const MAX_EVIDENCE_URLS = 6;
const MAX_RAW_CANDIDATES = 8;

function canUseMock(options = {}) {
  return options.allowMock === true || process.env.NODE_ENV === "test";
}

function normalizeProviderNames(providers, options = {}) {
  const configuredDefaults = getDefaultProviders();
  const names = Array.isArray(providers) && providers.length ? providers : configuredDefaults;
  const registered = new Set(listProviders());
  const normalized = names
    .map((provider) => String(provider).trim().toLowerCase())
    .filter((provider) => {
      if (!provider) return false;
      if (!registered.has(provider)) return false;
      if (provider === "mock") return canUseMock(options);
      return true;
    });
  if (!normalized.length) {
    // fall back to configured defaults intersected with registered
    const fallback = configuredDefaults.filter((p) => registered.has(p) && (p !== "mock" || canUseMock(options)));
    return fallback.length ? [...new Set(fallback)] : (listProviders().filter(p => p !== "mock" || canUseMock(options)).slice(0, 2) || []);
  }
  return [...new Set(normalized)];
}

function scoreFreshCandidates(persona, candidates, recentTopics, maxSignals = 20) {
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
      publishedAt: cluster.publishedAt,
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
    deduped,
    clusters,
    signals: signals.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, maxSignals)
  };
}

function toHermesSignal(signal, attribution) {
  const { rawCluster, ...signalWithoutCluster } = signal;
  return {
    ...signalWithoutCluster,
    source: signal.source || "Provider",
    sourceProvider: "Hermes",
    provider: attribution.provider,
    model: attribution.model,
    endpoint: attribution.endpoint,
    jobName: attribution.jobName,
    rawData: {
      ...(rawCluster || {}),
      providerBackedMorningDigest: true
    }
  };
}

export async function runProviderBackedMorningDigest({
  personas,
  recentTopicsByPersona = new Map(),
  importPayload,
  options = {}
}) {
  if (typeof importPayload !== "function") {
    throw new Error("importPayload function is required");
  }

  const providerNames = normalizeProviderNames(options.providers, options);
  const attribution = getHermesAttributionDefaults({
    provider: options.provider,
    model: options.model,
    endpoint: options.endpoint,
    jobName: options.jobName || "persona-command-center-morning-digest"
  });
  const startedAt = new Date().toISOString();
  const signalsByPersona = new Map();
  const topSignalsByPersona = [];
  const sourceSet = new Set();
  let candidateCount = 0;
  let staleFilteredCount = 0;
  let mockFilteredCount = 0;
  let missingDateFilteredCount = 0;
  let freshCandidateCount = 0;
  let dedupedCount = 0;
  let clusterCount = 0;

  const personaResults = await Promise.allSettled(personas.map(async (persona) => {
    const result = await buildSignalsForPersona(persona, recentTopicsByPersona.get(persona.id) || [], {
      providerNames,
      forceMock: providerNames.includes("mock"),
      ignoreProviderErrors: true,
      maxSignalsPerPersona: 200,
      timeoutMs: Number(options.timeoutMs || 6000)
    });

    const filtered = filterFreshCandidates(result.candidates, {
      now: options.now || new Date(),
      maxAgeHours: Number(options.maxAgeHours || 72),
      allowMissingPublishedAt: false,
      allowMockSources: providerNames.includes("mock") && canUseMock(options),
      rejectUpdatedOldContent: true
    });
    const scored = scoreFreshCandidates(
      persona,
      filtered.freshCandidates,
      recentTopicsByPersona.get(persona.id) || [],
      20
    );

    return { persona, result, filtered, scored };
  }));

  for (const settled of personaResults) {
    if (settled.status === "rejected") continue;
    const { persona, result, filtered, scored } = settled.value;
    candidateCount += filtered.counts.candidateCount;
    staleFilteredCount += filtered.counts.staleFilteredCount;
    mockFilteredCount += filtered.counts.mockFilteredCount;
    missingDateFilteredCount += filtered.counts.missingDateFilteredCount;
    freshCandidateCount += filtered.counts.freshCandidateCount;
    dedupedCount += scored.deduped.length;
    clusterCount += scored.clusters.length;
    for (const candidate of result.candidates) sourceSet.add(candidate.source);
    signalsByPersona.set(persona.id, scored.signals);
  }

  const selectedByPersona = selectMorningDigestSignals(personas, signalsByPersona, options.maxSignalsPerPersona || 3);
  const payload = {
    version: "2026-06-phase4d",
    runType: "morning_digest",
    provider: attribution.provider,
    model: attribution.model,
    endpoint: attribution.endpoint,
    jobName: attribution.jobName,
    generatedAt: new Date().toISOString(),
    personas: selectedByPersona.map((selection) => {
      const persona = personas.find((item) => item.id === selection.personaId);
      const selectedSignals = selection.selectedSignals.map((signal) => toHermesSignal(signal, attribution));
      topSignalsByPersona.push({
        personaId: selection.personaId,
        personaName: persona?.name || selection.personaId,
        summary: selection.summary,
        signalCount: selectedSignals.length,
        signals: selectedSignals
      });
      return {
        personaId: selection.personaId,
        summary: selection.summary,
        signals: selectedSignals
      };
    })
  };

  const importResult = await importPayload(payload);
  const completedAt = new Date().toISOString();
  return {
    runId: importResult.runId,
    startedAt,
    completedAt,
    providerNames,
    sourceCount: sourceSet.size,
    candidateCount,
    staleFilteredCount,
    mockFilteredCount,
    missingDateFilteredCount,
    freshCandidateCount,
    dedupedCount,
    clusterCount,
    signalCount: importResult.signalsReceived || topSignalsByPersona.reduce((total, item) => total + item.signalCount, 0),
    signalsCreated: importResult.imported || 0,
    signalsUpdated: importResult.updated || 0,
    importedSignalIds: importResult.importedSignalIds || [],
    topSignalsByPersona,
    attribution
  };
}

export { normalizeProviderNames };
