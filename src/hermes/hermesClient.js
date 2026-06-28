const RUN_TYPES = new Set(["morning_digest", "velocity_scan", "midday_brief", "evening_scan", "validation_ping", "trial_push"]);

function includesFallbackFailure(value) {
  return /searchagent unavailable|retrieval_failed|retrieval failed|connection refused|new opportunity detected/i.test(String(value || ""));
}

function hasUsableEvidence(signal) {
  return Array.isArray(signal?.evidenceUrls)
    && signal.evidenceUrls.some((url) => /^https?:\/\//i.test(String(url || "")));
}

function signalRawData(signal) {
  return signal?.rawData && typeof signal.rawData === "object" ? signal.rawData : {};
}

export function getHermesAttributionDefaults(overrides = {}) {
  return {
    provider: overrides.provider || process.env.HERMES_PROVIDER || "lmstudio",
    model: overrides.model || process.env.HERMES_MODEL || "qwen3.6-35b-a3b-mtp",
    endpoint: overrides.endpoint || process.env.HERMES_ENDPOINT || "http://localhost:1234/v1",
    jobName: overrides.jobName || process.env.HERMES_JOB_NAME || "hermes-intelligence-job",
    validationId: overrides.validationId || null
  };
}

export function validateHermesPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") errors.push("payload must be an object");
  if (!RUN_TYPES.has(payload?.runType)) errors.push("runType must be one of morning_digest, velocity_scan, midday_brief, evening_scan, validation_ping");
  if (!payload?.generatedAt || Number.isNaN(new Date(payload.generatedAt).getTime())) errors.push("generatedAt must be an ISO date");
  if (!Array.isArray(payload?.personas)) errors.push("personas must be an array");
  if (payload?.runType === "validation_ping") {
    if (!payload.jobName) errors.push("jobName is required for validation_ping");
    if (!payload.provider) errors.push("provider is required for validation_ping");
    if (!payload.model) errors.push("model is required for validation_ping");
    if (!payload.endpoint) errors.push("endpoint is required for validation_ping");
    if (!payload.validationId) errors.push("validationId is required for validation_ping");
  }

  for (const [personaIndex, persona] of (payload?.personas || []).entries()) {
    if (!persona.personaId) errors.push(`personas[${personaIndex}].personaId is required`);
    if (!Array.isArray(persona.signals)) errors.push(`personas[${personaIndex}].signals must be an array`);
    for (const [signalIndex, signal] of (persona.signals || []).entries()) {
      const prefix = `personas[${personaIndex}].signals[${signalIndex}]`;
      if (!signal.topic) errors.push(`${prefix}.topic is required`);
      if (!signal.source) errors.push(`${prefix}.source is required`);
      if (!signal.suggestedAngle) errors.push(`${prefix}.suggestedAngle is required`);
      const rawData = signalRawData(signal);
      const retrievalStatus = String(rawData.retrievalStatus || signal.retrievalStatus || "").toLowerCase();
      const evidenceText = JSON.stringify(signal.evidenceUrls || []);
      if (retrievalStatus === "retrieval_failed" || retrievalStatus === "unavailable" || retrievalStatus === "error") {
        errors.push(`${prefix} has retrieval status ${retrievalStatus}; failed retrievals must not be imported`);
      }
      if (includesFallbackFailure(signal.topic) || includesFallbackFailure(evidenceText) || includesFallbackFailure(rawData.error)) {
        errors.push(`${prefix} appears to be a fallback/failed-retrieval placeholder`);
      }
      if ((signal.source || "").toLowerCase().includes("hermes_x_search") && !hasUsableEvidence(signal)) {
        errors.push(`${prefix}.evidenceUrls must include at least one usable URL for hermes_x_search imports`);
      }
    }
  }

  if (errors.length) {
    const error = new Error(`Invalid Hermes payload: ${errors.join("; ")}`);
    error.status = 400;
    error.validationErrors = errors;
    throw error;
  }

  return true;
}

export function normalizeHermesSignal(signal, personaId, runType, generatedAt, attribution = {}) {
  const defaults = getHermesAttributionDefaults(attribution);
  const topic = normalizeSignalTopic(signal.topic, signal);
  const editorialMetadata = normalizeEditorialMetadata(signal);
  return {
    testMode: signal.testMode === true,
    personaId,
    topic,
    source: signal.source || "Hermes",
    query: signal.query || topic,
    firstSeenAt: signal.firstSeenAt || signal.publishedAt || generatedAt,
    lastSeenAt: signal.lastSeenAt || generatedAt,
    velocityScore: Number(signal.velocityScore ?? 50),
    relevanceScore: Number(signal.relevanceScore ?? 70),
    noveltyScore: Number(signal.noveltyScore ?? 70),
    freshnessScore: Number(signal.freshnessScore ?? 75),
    riskScore: Number(signal.riskScore ?? 15),
    priorityScore: Number(signal.priorityScore ?? 75),
    sourceCount: Number(signal.sourceCount ?? 1),
    clusterId: signal.clusterId || `hermes-${runType}-${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`,
    suggestedAngle: signal.suggestedAngle,
    evidenceUrls: Array.isArray(signal.evidenceUrls) ? signal.evidenceUrls : [],
    sourceProvider: signal.sourceProvider || "Hermes",
    hermesRunType: runType,
    hermesProvider: signal.provider || defaults.provider,
    hermesModel: signal.model || defaults.model,
    hermesEndpoint: signal.endpoint || defaults.endpoint,
    hermesJobName: signal.jobName || defaults.jobName,
    validationId: signal.validationId || defaults.validationId,
    editorialMetadata,
    rawData: signal.rawData || signal
  };
}

export function normalizeEditorialMetadata(source = {}) {
  const fields = [
    "conversationContext",
    "whyPeopleCare",
    "tensionOrContradiction",
    "surprisingAngle",
    "personaEntryPoint",
    "draftStrategy",
    "qualityScore",
    "qualityWarnings"
  ];
  const metadata = {};
  for (const field of fields) {
    const value = source[field] ?? source.rawData?.[field];
    if (value === undefined || value === null || value === "") continue;
    metadata[field] = value;
  }
  if (Array.isArray(metadata.qualityWarnings)) {
    metadata.qualityWarnings = metadata.qualityWarnings.filter(Boolean).map(String);
  } else if (metadata.qualityWarnings !== undefined) {
    metadata.qualityWarnings = [String(metadata.qualityWarnings)];
  }
  if (metadata.qualityScore !== undefined) {
    metadata.qualityScore = Number(metadata.qualityScore);
  }
  const rawData = signalRawData(source);
  if (rawData.editorialIntelligence && typeof rawData.editorialIntelligence === "object") {
    metadata.editorialIntelligence = rawData.editorialIntelligence;
  }
  if (rawData.draftQualityGate && typeof rawData.draftQualityGate === "object") {
    metadata.draftQualityGate = rawData.draftQualityGate;
  }
  if (Array.isArray(rawData.drafts)) {
    metadata.importedDrafts = rawData.drafts
      .map((draft) => ({
        angle: draft?.angle,
        content: String(draft?.content || draft?.body || "").trim(),
        characterCount: Number(draft?.character_count || draft?.characterCount || 0)
      }))
      .filter((draft) => draft.content);
  }
  return metadata;
}

function normalizeSignalTopic(topic, signal = {}) {
  if (!topic) return topic;
  const entityName = signal.rawData?.entityName || signal.entityName;
  const summary = String(signal.summary || signal.rawData?.summary || signal.rawData?.finding || "").trim();
  const lower = String(topic).toLowerCase();
  if (entityName && /\/\s*(highlights|posts|posts and replies)\s*\/\s*x\s*-?\s*twitter/i.test(topic)) {
    if (/surveillance|behavior/i.test(summary)) return `${entityName} comments on surveillance and behavior`;
    if (/school|education|student/i.test(summary)) return `${entityName} comments on AI use in schools`;
    if (/interface|claude|tag|llm/i.test(summary)) return `${entityName} analyzes a new LLM interface`;
    if (/longevity|protocol|health/i.test(summary)) return `${entityName} shares longevity protocol updates`;
    return `${entityName} shares a timely update`;
  }
  const rawPatterns = [
    /^.+\s*\(@\w+\)\s*\/\s*Posts and Replies\s*\/\s*X\s*-\s*Twitter$/i,
    /^.+\s*\(@\w+\)\s*\/\s*Posts\s*\/\s*X$/i,
    /^.+\s*\(@\w+\)\s*\/\s*Highlights\s*\/\s*X\s*-\s*Twitter$/i,
    /^(.+?)\s*\(@\w+\)\s*\/\s*.+?\s*\/\s*X\s*-\s*Twitter$/i,
    /^Recent activity from\s+(.+)$/i,
    /^Watch List entity\s+(.+?)\(/
  ];
  for (const pattern of rawPatterns) {
    const match = topic.match(pattern);
    if (match && match[1]) {
      const clean = match[1].trim().replace(/\s*\(@?\w+\)\s*$/, "").trim();
      if (clean) return `${clean} — recent activity`;
    }
  }
  if (entityName && (lower.includes("x - twitter") || lower.includes("twitter"))) {
    return `${entityName} shares a timely update`;
  }
  if (/^\s*(https?:\/\/|www\.)/i.test(topic)) return "External link — review and consider";
  return topic;
}
