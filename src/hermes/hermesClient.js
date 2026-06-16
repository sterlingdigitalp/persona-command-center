const RUN_TYPES = new Set(["morning_digest", "velocity_scan", "midday_brief", "evening_scan", "validation_ping"]);

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
  return {
    personaId,
    topic: signal.topic,
    source: signal.source || "Hermes",
    query: signal.query || signal.topic,
    firstSeenAt: signal.firstSeenAt || signal.publishedAt || generatedAt,
    lastSeenAt: signal.lastSeenAt || generatedAt,
    velocityScore: Number(signal.velocityScore ?? 50),
    relevanceScore: Number(signal.relevanceScore ?? 70),
    noveltyScore: Number(signal.noveltyScore ?? 70),
    freshnessScore: Number(signal.freshnessScore ?? 75),
    riskScore: Number(signal.riskScore ?? 15),
    priorityScore: Number(signal.priorityScore ?? 75),
    sourceCount: Number(signal.sourceCount ?? 1),
    clusterId: signal.clusterId || `hermes-${runType}-${signal.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`,
    suggestedAngle: signal.suggestedAngle,
    evidenceUrls: Array.isArray(signal.evidenceUrls) ? signal.evidenceUrls : [],
    sourceProvider: signal.sourceProvider || "Hermes",
    hermesRunType: runType,
    hermesProvider: signal.provider || defaults.provider,
    hermesModel: signal.model || defaults.model,
    hermesEndpoint: signal.endpoint || defaults.endpoint,
    hermesJobName: signal.jobName || defaults.jobName,
    validationId: signal.validationId || defaults.validationId,
    rawData: signal.rawData || signal
  };
}
