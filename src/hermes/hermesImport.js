import {
  execSql,
  newId,
  parseJsonField,
  querySql,
  sqlJson,
  sqlString
} from "../db.js";
import { overlapScore } from "../ingestion/text.js";
import { generateVelocityAlerts } from "../velocity/alertEngine.js";
import { getHermesAttributionDefaults, normalizeHermesSignal, validateHermesPayload } from "./hermesClient.js";

async function audit(action, entityType, entityId, metadata = {}) {
  await execSql(`
    INSERT INTO audit_log (id, actor, action, entity_type, entity_id, metadata)
    VALUES (${sqlString(newId("audit"))}, 'hermes', ${sqlString(action)}, ${sqlString(entityType)}, ${sqlString(entityId)}, ${sqlJson(metadata)});
  `);
}

function mapSignal(row) {
  return {
    id: row.id,
    personaId: row.persona_id,
    topic: row.topic,
    priorityScore: row.priority_score || 0,
    status: row.status,
    validationId: row.validation_id,
    evidenceUrls: parseJsonField(row.evidence_urls, [])
  };
}

async function findDuplicateSignal(signal) {
  const rows = await querySql(`
    SELECT *
    FROM signals
    WHERE persona_id = ${sqlString(signal.personaId)}
      AND status != 'archived'
      AND (
        cluster_id = ${sqlString(signal.clusterId)}
        OR date(last_seen_at) >= date('now', '-7 day')
      )
    ORDER BY last_seen_at DESC
    LIMIT 80;
  `);
  return rows.map(mapSignal).find((existing) => (
    existing.id && (
      existing.topic === signal.topic ||
      overlapScore(existing.topic, signal.topic) >= 0.72
    )
  ));
}

async function snapshotSignal(signalId, runId, signal, rawPayload = {}) {
  await execSql(`
    INSERT INTO signal_snapshots (
      id, signal_id, ingestion_run_id, captured_at,
      velocity_score, relevance_score, novelty_score, freshness_score,
      priority_score, risk_score, source_count, cluster_id, raw_payload
    )
    VALUES (
      ${sqlString(newId("snap"))}, ${sqlString(signalId)}, ${sqlString(runId)}, ${sqlString(signal.lastSeenAt)},
      ${signal.velocityScore}, ${signal.relevanceScore}, ${signal.noveltyScore}, ${signal.freshnessScore},
      ${signal.priorityScore}, ${signal.riskScore}, ${signal.sourceCount}, ${sqlString(signal.clusterId)}, ${sqlJson(rawPayload)}
    );
  `);
}

async function insertSignal(runId, signal) {
  const signalId = newId("sig");
  await execSql(`
    INSERT INTO signals (
      id, persona_id, topic, source, query, first_seen_at, last_seen_at,
      velocity_score, relevance_score, novelty_score, freshness_score, risk_score,
      priority_score, source_count, cluster_id, generated_by, source_provider,
      hermes_run_type, hermes_provider, hermes_model, hermes_endpoint,
      hermes_job_name, validation_id, status, suggested_angle, evidence_urls
    )
    VALUES (
      ${sqlString(signalId)}, ${sqlString(signal.personaId)}, ${sqlString(signal.topic)},
      ${sqlString(signal.source)}, ${sqlString(signal.query)}, ${sqlString(signal.firstSeenAt)},
      ${sqlString(signal.lastSeenAt)}, ${signal.velocityScore}, ${signal.relevanceScore},
      ${signal.noveltyScore}, ${signal.freshnessScore}, ${signal.riskScore},
      ${signal.priorityScore}, ${signal.sourceCount}, ${sqlString(signal.clusterId)},
      'Hermes', ${sqlString(signal.sourceProvider)}, ${sqlString(signal.hermesRunType)},
      ${sqlString(signal.hermesProvider)}, ${sqlString(signal.hermesModel)}, ${sqlString(signal.hermesEndpoint)},
      ${sqlString(signal.hermesJobName)}, ${sqlString(signal.validationId)},
      'new', ${sqlString(signal.suggestedAngle)}, ${sqlJson(signal.evidenceUrls)}
    );
  `);
  await snapshotSignal(signalId, runId, signal, signal.rawData);
  return signalId;
}

async function updateSignal(runId, existing, signal) {
  await execSql(`
    UPDATE signals
    SET
      last_seen_at = ${sqlString(signal.lastSeenAt)},
      velocity_score = ${signal.velocityScore},
      relevance_score = ${signal.relevanceScore},
      novelty_score = ${signal.noveltyScore},
      freshness_score = ${signal.freshnessScore},
      risk_score = ${signal.riskScore},
      priority_score = ${signal.priorityScore},
      source_count = MAX(source_count, ${signal.sourceCount}),
      generated_by = 'Hermes',
      source_provider = ${sqlString(signal.sourceProvider)},
      hermes_run_type = ${sqlString(signal.hermesRunType)},
      hermes_provider = ${sqlString(signal.hermesProvider)},
      hermes_model = ${sqlString(signal.hermesModel)},
      hermes_endpoint = ${sqlString(signal.hermesEndpoint)},
      hermes_job_name = ${sqlString(signal.hermesJobName)},
      validation_id = ${sqlString(signal.validationId)},
      suggested_angle = ${sqlString(signal.suggestedAngle)}
    WHERE id = ${sqlString(existing.id)};
  `);
  await snapshotSignal(existing.id, runId, signal, { ...signal.rawData, duplicateOf: existing.id });
  return existing.id;
}

export async function importHermesPayload(payload) {
  validateHermesPayload(payload);
  const attribution = getHermesAttributionDefaults({
    provider: payload.provider,
    model: payload.model,
    endpoint: payload.endpoint,
    jobName: payload.jobName || `persona-command-center-${payload.runType}`,
    validationId: payload.validationId
  });
  const runId = newId("run");
  const startedAt = new Date().toISOString();
  await execSql(`
    INSERT INTO ingestion_runs (
      id, run_type, status, started_at, generated_by,
      provider, model, endpoint, job_name, validation_id,
      source_count, candidate_count, cluster_count, signal_count, signals_created, notes
    )
    VALUES (
      ${sqlString(runId)}, ${sqlString(payload.runType)}, 'running', ${sqlString(startedAt)}, 'Hermes',
      ${sqlString(attribution.provider)}, ${sqlString(attribution.model)}, ${sqlString(attribution.endpoint)},
      ${sqlString(attribution.jobName)}, ${sqlString(attribution.validationId)},
      0, 0, 0, 0, 0, ${sqlString(`Hermes ${payload.runType} import started`)}
    );
  `);

  let imported = 0;
  let updated = 0;
  const importedSignalIds = [];
  const sourceSet = new Set();
  const normalizedSignals = [];

  try {
    for (const persona of payload.personas) {
      for (const rawSignal of persona.signals) {
        const signal = normalizeHermesSignal(rawSignal, persona.personaId, payload.runType, payload.generatedAt, {
          provider: attribution.provider,
          model: attribution.model,
          endpoint: attribution.endpoint,
          jobName: attribution.jobName,
          validationId: attribution.validationId
        });
        normalizedSignals.push(signal);
        sourceSet.add(signal.source);
        const duplicate = await findDuplicateSignal(signal);
        if (duplicate) {
          const signalId = await updateSignal(runId, duplicate, signal);
          importedSignalIds.push(signalId);
          updated += 1;
        } else {
          const signalId = await insertSignal(runId, signal);
          importedSignalIds.push(signalId);
          imported += 1;
        }
      }
    }

    await execSql(`
      UPDATE ingestion_runs
      SET status = 'completed',
          completed_at = ${sqlString(new Date().toISOString())},
          source_count = ${sourceSet.size},
          candidate_count = ${normalizedSignals.length},
          cluster_count = ${new Set(normalizedSignals.map((signal) => signal.clusterId)).size},
          signal_count = ${normalizedSignals.length},
          signals_created = ${imported},
          notes = ${sqlString(`Hermes ${payload.runType}: ${imported} new, ${updated} updated`)}
      WHERE id = ${sqlString(runId)};
    `);
    await audit("hermes.import.completed", "ingestion_run", runId, { imported, updated, runType: payload.runType });
    await generateVelocityAlerts({ signalIds: [...new Set(importedSignalIds)] });
    if (payload.runType === "validation_ping") {
      await audit("hermes_validation_imported", "ingestion_run", runId, {
        validationId: payload.validationId,
        importedSignalIds,
        provider: attribution.provider,
        model: attribution.model,
        endpoint: attribution.endpoint
      });
    }
  } catch (error) {
    await execSql(`
      UPDATE ingestion_runs
      SET status = 'failed',
          completed_at = ${sqlString(new Date().toISOString())},
          error_message = ${sqlString(error.message)}
      WHERE id = ${sqlString(runId)};
    `);
    throw error;
  }

  return { runId, runType: payload.runType, imported, updated, signalsReceived: normalizedSignals.length, importedSignalIds };
}
