export const CONTRACT_VERSION = "2026-06-phase4a";

export function buildValidationPayload(exportState, options = {}) {
  const persona = exportState.personas?.[0];
  if (!persona) {
    throw new Error("No personas available for validation");
  }

  const generatedAt = new Date().toISOString();
  const validationId = options.validationId || `validation_${Date.now()}`;
  const provider = options.provider || "lmstudio";
  const model = options.model || "qwen3.6-35b-a3b-mtp";
  const endpoint = options.endpoint || "http://localhost:1234/v1";
  const jobName = options.jobName || "hermes-connectivity-validation";

  return {
    version: CONTRACT_VERSION,
    runType: "validation_ping",
    jobName,
    provider,
    model,
    endpoint,
    generatedAt,
    validationId,
    personas: [
      {
        personaId: persona.id,
        signals: [
          {
            topic: "Hermes Validation Signal",
            source: "Hermes",
            sourceProvider: "Hermes",
            provider,
            model,
            endpoint,
            jobName,
            validationId,
            query: persona.queries?.[0]?.query || persona.niche,
            firstSeenAt: generatedAt,
            lastSeenAt: generatedAt,
            velocityScore: 50,
            relevanceScore: 80,
            noveltyScore: 95,
            freshnessScore: 100,
            riskScore: 5,
            priorityScore: 88,
            sourceCount: 1,
            clusterId: `hermes-validation-${validationId}`,
            suggestedAngle: `${persona.name}: validation round trip confirmed for ${provider}/${model}.`,
            evidenceUrls: [`${endpoint.replace(/\/$/, "")}/validation/${validationId}`],
            rawData: {
              validation: true,
              contractVersion: exportState.contractVersion,
              exportedPersonaCount: exportState.personas.length
            }
          }
        ]
      }
    ]
  };
}

export async function runValidationAgainstBaseUrl(baseUrl, options = {}) {
  const result = {
    exportReachable: false,
    importReachable: false,
    validationSignalCreated: false,
    validationId: null,
    importedSignalIds: [],
    errors: []
  };

  try {
    const exportResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/api/hermes/export`);
    result.exportReachable = exportResponse.ok;
    if (!exportResponse.ok) throw new Error(`Export failed: ${exportResponse.status}`);
    const exportState = await exportResponse.json();
    const payload = buildValidationPayload(exportState, options);
    result.validationId = payload.validationId;

    const importResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/api/hermes/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    result.importReachable = importResponse.ok;
    const importResult = await importResponse.json();
    if (!importResponse.ok) throw new Error(`Import failed: ${JSON.stringify(importResult)}`);
    result.importedSignalIds = importResult.importedSignalIds || [];
    result.validationSignalCreated = result.importedSignalIds.length > 0;
  } catch (error) {
    result.errors.push(error.message);
  }

  return result;
}
