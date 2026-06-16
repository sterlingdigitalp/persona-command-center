import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  execSql,
  initDb,
  newId,
  parseJsonField,
  querySql,
  sqlJson,
  sqlString
} from "./db.js";
import { buildSignalsForPersona } from "./ingestion/pipeline.js";
import { importHermesPayload } from "./hermes/hermesImport.js";
import { buildHermesSimulationPayload } from "./hermes/hermesJobs.js";
import { runProviderBackedMorningDigest } from "./hermes/providerMorningDigest.js";
import { buildValidationPayload, CONTRACT_VERSION } from "./hermes/validationJob.js";
import { getLatestVelocitySummary, getVelocityAlerts } from "./velocity/alertEngine.js";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const port = Number(process.env.PORT || 3000);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    ...extraHeaders
  });
  res.end(text);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) return {};
  return JSON.parse(body);
}

function mapPersona(row, queries = []) {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    account: row.handle,
    niche: row.niche,
    voiceTone: row.voice_tone,
    platformStatus: row.platform_status,
    userEdited: Boolean(row.user_edited),
    userEditedAt: row.user_edited_at,
    lockedFromSeedOverwrite: Boolean(row.locked_from_seed_overwrite),
    queries
  };
}

function mapPersonaQuery(row) {
  return {
    id: row.id,
    personaId: row.persona_id,
    query: row.query,
    sourceType: row.source_type,
    provider: row.provider || row.source_type || "news",
    weight: row.weight || 1,
    isActive: Boolean(row.is_active),
    userEdited: Boolean(row.user_edited),
    userEditedAt: row.user_edited_at,
    lockedFromSeedOverwrite: Boolean(row.locked_from_seed_overwrite),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSignal(row) {
  return {
    id: row.id,
    personaId: row.persona_id,
    topic: row.topic,
    source: row.source,
    query: row.query,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    velocityScore: row.velocity_score,
    relevanceScore: row.relevance_score,
    noveltyScore: row.novelty_score,
    freshnessScore: row.freshness_score || 0,
    riskScore: row.risk_score,
    priorityScore: row.priority_score || 0,
    sourceCount: row.source_count || 1,
    clusterId: row.cluster_id,
    generatedBy: row.generated_by,
    sourceProvider: row.source_provider,
    hermesRunType: row.hermes_run_type,
    hermesProvider: row.hermes_provider,
    hermesModel: row.hermes_model,
    hermesEndpoint: row.hermes_endpoint,
    hermesJobName: row.hermes_job_name,
    validationId: row.validation_id,
    status: row.status || "new",
    reviewedAt: row.reviewed_at,
    dismissedAt: row.dismissed_at,
    usedAt: row.used_at,
    suggestedAngle: row.suggested_angle,
    evidenceUrls: parseJsonField(row.evidence_urls, [])
  };
}

function mapDraft(row) {
  return {
    id: row.id,
    personaId: row.persona_id,
    body: row.edited_body || row.body,
    originalBody: row.original_body || row.body,
    editedBody: row.edited_body || row.body,
    platform: row.platform || "x",
    mediaRefs: parseJsonField(row.media_refs, []),
    hashtags: parseJsonField(row.hashtags, []),
    status: row.status,
    sourceSignalIds: parseJsonField(row.source_signal_ids, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapScheduledPost(row) {
  return {
    id: row.id,
    draftId: row.draft_id,
    personaId: row.persona_id,
    platform: row.platform,
    body: row.body,
    mediaRefs: parseJsonField(row.media_refs, []),
    hashtags: parseJsonField(row.hashtags, []),
    status: row.status,
    scheduledAt: row.scheduled_at,
    sourceSignalIds: parseJsonField(row.source_signal_ids, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapIngestionRun(row) {
  return {
    id: row.id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    runType: row.run_type || "mock",
    status: row.status,
    signalsCreated: row.signals_created || 0,
    sourceCount: row.source_count || 0,
    candidateCount: row.candidate_count || 0,
    clusterCount: row.cluster_count || 0,
    signalCount: row.signal_count || row.signals_created || 0,
    generatedBy: row.generated_by,
    provider: row.provider,
    model: row.model,
    endpoint: row.endpoint,
    jobName: row.job_name,
    validationId: row.validation_id,
    notes: row.notes || row.summary || null,
    errorMessage: row.error_message
  };
}

function mapSnapshot(row) {
  return {
    id: row.id,
    signalId: row.signal_id,
    ingestionRunId: row.ingestion_run_id,
    capturedAt: row.captured_at,
    velocityScore: row.velocity_score,
    relevanceScore: row.relevance_score,
    noveltyScore: row.novelty_score,
    freshnessScore: row.freshness_score || 0,
    priorityScore: row.priority_score || 0,
    riskScore: row.risk_score,
    rawPayload: parseJsonField(row.raw_payload, {})
  };
}

function mapAudit(row) {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: parseJsonField(row.metadata, {}),
    createdAt: row.created_at
  };
}

async function audit(action, entityType, entityId, metadata = {}) {
  await execSql(`
    INSERT INTO audit_log (id, actor, action, entity_type, entity_id, metadata)
    VALUES (${sqlString(newId("audit"))}, 'system', ${sqlString(action)}, ${sqlString(entityType)}, ${sqlString(entityId)}, ${sqlJson(metadata)});
  `);
}

async function getPersonas({ includeInactiveQueries = false } = {}) {
  const personas = await querySql("SELECT * FROM personas ORDER BY rowid;");
  const queries = await querySql(`
    SELECT *
    FROM persona_queries
    ${includeInactiveQueries ? "" : "WHERE is_active = 1"}
    ORDER BY rowid;
  `);
  return personas.map((persona) => mapPersona(
    persona,
    queries.filter((query) => query.persona_id === persona.id).map(mapPersonaQuery)
  ));
}

async function getPersona(personaId, { includeInactiveQueries = true } = {}) {
  const personas = await querySql(`SELECT * FROM personas WHERE id = ${sqlString(personaId)} LIMIT 1;`);
  if (!personas.length) return null;
  const queryWhere = includeInactiveQueries ? "" : "AND is_active = 1";
  const queries = await querySql(`
    SELECT *
    FROM persona_queries
    WHERE persona_id = ${sqlString(personaId)}
      ${queryWhere}
    ORDER BY rowid;
  `);
  return mapPersona(personas[0], queries.map(mapPersonaQuery));
}

async function getSetupStatus() {
  const rows = await querySql("SELECT COUNT(*) AS count FROM personas;");
  const personaCount = Number(rows[0]?.count || 0);
  return {
    backendReachable: true,
    personasInitialized: personaCount > 0,
    personaCount
  };
}

async function getTodaySignals() {
  const rows = await querySql(`
    SELECT *
    FROM signals
    WHERE date(last_seen_at) = date('now')
      AND status NOT IN ('dismissed', 'archived')
    ORDER BY priority_score DESC, relevance_score DESC, velocity_score DESC, last_seen_at DESC;
  `);
  return rows.map(mapSignal);
}

async function getSignals(filters = {}) {
  const clauses = ["1 = 1"];
  if (filters.personaId) clauses.push(`persona_id = ${sqlString(filters.personaId)}`);
  if (filters.status) clauses.push(`status = ${sqlString(filters.status)}`);
  if (!filters.includeDismissed) clauses.push("status NOT IN ('dismissed', 'archived')");
  const sort = filters.sort === "freshness"
    ? "freshness_score DESC, last_seen_at DESC"
    : "priority_score DESC, relevance_score DESC, last_seen_at DESC";
  const limit = Math.max(1, Math.min(200, Number(filters.limit || 100)));
  const rows = await querySql(`
    SELECT *
    FROM signals
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${sort}
    LIMIT ${limit};
  `);
  return rows.map(mapSignal);
}

async function getSignalsForPersona(personaId) {
  const rows = await querySql(`
    SELECT *
    FROM signals
    WHERE persona_id = ${sqlString(personaId)}
      AND status NOT IN ('dismissed', 'archived')
    ORDER BY priority_score DESC, last_seen_at DESC, relevance_score DESC
    LIMIT 30;
  `);
  return rows.map(mapSignal);
}

async function getSignal(signalId) {
  const rows = await querySql(`SELECT * FROM signals WHERE id = ${sqlString(signalId)} LIMIT 1;`);
  return rows.length ? mapSignal(rows[0]) : null;
}

async function updateSignal(signalId, payload) {
  const existing = await getSignal(signalId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const status = payload.status || existing.status;
  const reviewedAt = status === "reviewed" ? now : existing.reviewedAt;
  const dismissedAt = status === "dismissed" ? now : existing.dismissedAt;
  const usedAt = status === "used" ? now : existing.usedAt;

  await execSql(`
    UPDATE signals
    SET
      status = ${sqlString(status)},
      reviewed_at = ${sqlString(reviewedAt)},
      dismissed_at = ${sqlString(dismissedAt)},
      used_at = ${sqlString(usedAt)},
      last_seen_at = COALESCE(${sqlString(payload.lastSeenAt)}, last_seen_at)
    WHERE id = ${sqlString(signalId)};
  `);
  if (status === "dismissed") await audit("signal.dismissed", "signal", signalId);
  if (status === "reviewed") await audit("signal.reviewed", "signal", signalId);
  return getSignal(signalId);
}

async function updatePersona(personaId, payload) {
  const existing = await querySql(`SELECT * FROM personas WHERE id = ${sqlString(personaId)} LIMIT 1;`);
  if (!existing.length) return null;
  const normalized = normalizePersonaPayload(payload);

  await execSql(`
    UPDATE personas
    SET
      name = COALESCE(${sqlString(normalized.name)}, name),
      handle = COALESCE(${sqlString(normalized.handle)}, handle),
      niche = COALESCE(${sqlString(normalized.niche)}, niche),
      voice_tone = COALESCE(${sqlString(normalized.voiceTone)}, voice_tone),
      platform_status = COALESCE(${sqlString(normalized.platformStatus)}, platform_status),
      user_edited = 1,
      user_edited_at = CURRENT_TIMESTAMP,
      locked_from_seed_overwrite = 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${sqlString(personaId)};
  `);

  if (Array.isArray(payload.queries)) {
    await execSql(`
      UPDATE persona_queries
      SET is_active = 0,
          user_edited = 1,
          user_edited_at = CURRENT_TIMESTAMP,
          locked_from_seed_overwrite = 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE persona_id = ${sqlString(personaId)};
    `);
    for (const query of payload.queries) {
      const normalizedQuery = normalizeQueryPayload(typeof query === "string" ? { query } : query, { partial: false });
      await execSql(`
        INSERT INTO persona_queries (
          id, persona_id, query, source_type, provider, weight, is_active,
          user_edited, user_edited_at, locked_from_seed_overwrite, updated_at
        )
        VALUES (
          ${sqlString(newId("query"))}, ${sqlString(personaId)},
          ${sqlString(normalizedQuery.query)},
          ${sqlString(normalizedQuery.sourceType || "public_feed")},
          ${sqlString(normalizedQuery.provider || "news")},
          ${Number(normalizedQuery.weight || 1)},
          1,
          1,
          CURRENT_TIMESTAMP,
          1,
          CURRENT_TIMESTAMP
        );
      `);
    }
  }

  await audit("persona.updated", "persona", personaId, { personaId, fields: Object.keys(payload) });
  return getPersona(personaId);
}

async function addPersonaQuery(personaId, payload) {
  if (!(await getPersona(personaId))) return null;
  const query = normalizeQueryPayload(payload, { partial: false });
  const queryId = newId("query");
  await execSql(`
    INSERT INTO persona_queries (
      id, persona_id, query, source_type, provider, weight, is_active,
      user_edited, user_edited_at, locked_from_seed_overwrite, updated_at
    )
    VALUES (
      ${sqlString(queryId)}, ${sqlString(personaId)}, ${sqlString(query.query)},
      ${sqlString(query.sourceType || "public_feed")}, ${sqlString(query.provider || "news")},
      ${Number(query.weight || 1)}, ${query.isActive === false ? 0 : 1},
      1, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP
    );
  `);
  await audit("persona_query.created", "persona_query", queryId, { personaId, queryId });
  return getPersona(personaId);
}

async function deletePersonaQuery(personaId, queryId) {
  const existing = await getPersonaQuery(personaId, queryId);
  if (!existing) return null;
  await execSql(`
    DELETE FROM persona_queries
    WHERE id = ${sqlString(queryId)} AND persona_id = ${sqlString(personaId)};
  `);
  await audit("persona_query.deleted", "persona_query", queryId, { personaId, queryId });
  return getPersona(personaId);
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeHandle(handle) {
  const value = String(handle || "").trim();
  if (!value) throw validationError("handle is required");
  return value.startsWith("@") ? value : `@${value}`;
}

function slugifyPersonaId(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw validationError("persona id could not be created");
  return slug.slice(0, 80);
}

function normalizeProvider(provider) {
  const value = String(provider || "news").trim().toLowerCase();
  if (!["rss", "news", "mock"].includes(value)) throw validationError("provider must be rss, news, or mock");
  return value;
}

function normalizePlatformStatus(status) {
  const value = String(status || "active").trim().toLowerCase();
  if (!value || value === "mock") return "active";
  if (!["active", "configured", "draft", "disconnected"].includes(value)) {
    throw validationError("platformStatus must be active, configured, draft, or disconnected");
  }
  return value;
}

function normalizeWeight(weight) {
  const value = Math.max(1, Math.min(5, Number(weight || 1)));
  return Number.isFinite(value) ? Math.round(value) : 1;
}

function normalizePersonaPayload(payload = {}) {
  const normalized = {};
  if (payload.name !== undefined) {
    normalized.name = String(payload.name).trim();
    if (!normalized.name) throw validationError("name is required");
  }
  if (payload.handle !== undefined || payload.account !== undefined) {
    normalized.handle = normalizeHandle(payload.handle ?? payload.account);
  }
  if (payload.niche !== undefined) {
    normalized.niche = String(payload.niche).trim();
    if (!normalized.niche) throw validationError("niche is required");
  }
  if (payload.voiceTone !== undefined) {
    normalized.voiceTone = String(payload.voiceTone).trim();
    if (!normalized.voiceTone) throw validationError("voiceTone is required");
  }
  if (payload.platformStatus !== undefined) {
    normalized.platformStatus = normalizePlatformStatus(payload.platformStatus);
  }
  return normalized;
}

function normalizeInitializePersonaPayload(payload = {}) {
  const persona = normalizePersonaPayload(payload);
  if (!persona.name) throw validationError("name is required");
  if (!persona.handle) persona.handle = normalizeHandle(payload.handle ?? payload.account);
  if (!persona.niche) throw validationError("niche is required");
  if (!persona.voiceTone) throw validationError("voiceTone is required");
  persona.platformStatus = normalizePlatformStatus(payload.platformStatus || "active");
  persona.id = payload.id ? slugifyPersonaId(payload.id) : slugifyPersonaId(persona.handle || persona.name);
  const queries = Array.isArray(payload.queries) ? payload.queries : [];
  if (queries.length < 3) throw validationError(`${persona.name} requires at least 3 search terms`);
  persona.queries = queries.map((query) => normalizeQueryPayload({
    ...query,
    provider: query.provider || "news",
    weight: query.weight || 3,
    isActive: query.isActive !== false
  }, { partial: false }));
  return persona;
}

async function initializePersonas(payload = {}) {
  const incoming = Array.isArray(payload.personas) ? payload.personas : [];
  if (incoming.length !== 4) throw validationError("initialize requires exactly 4 personas");
  const normalizedPersonas = incoming.map(normalizeInitializePersonaPayload);
  const ids = new Set(normalizedPersonas.map((persona) => persona.id));
  if (ids.size !== normalizedPersonas.length) throw validationError("persona ids must be unique");

  const existing = await getPersonas({ includeInactiveQueries: true });
  if (existing.length) {
    await audit("setup.skipped_existing_personas", "persona", "all", {
      reason: "existing_personas_protected",
      personaCount: existing.length
    });
    return existing;
  }
  const existingByHandle = new Map(existing.map((persona) => [String(persona.handle || "").toLowerCase(), persona.id]));
  const initialized = [];

  for (const persona of normalizedPersonas) {
    const personaId = existingByHandle.get(persona.handle.toLowerCase()) || persona.id;
    await execSql(`
      INSERT INTO personas (
        id, name, handle, niche, voice_tone, platform_status,
        user_edited, user_edited_at, locked_from_seed_overwrite, updated_at
      )
      VALUES (
        ${sqlString(personaId)},
        ${sqlString(persona.name)},
        ${sqlString(persona.handle)},
        ${sqlString(persona.niche)},
        ${sqlString(persona.voiceTone)},
        ${sqlString(persona.platformStatus)},
        1,
        CURRENT_TIMESTAMP,
        1,
        CURRENT_TIMESTAMP
      );
    `);

    let index = 0;
    for (const query of persona.queries) {
      index += 1;
      const queryId = `${personaId}-query-${index}`;
      await execSql(`
        INSERT INTO persona_queries (
          id, persona_id, query, source_type, provider, weight, is_active,
          user_edited, user_edited_at, locked_from_seed_overwrite, updated_at
        )
        VALUES (
          ${sqlString(queryId)},
          ${sqlString(personaId)},
          ${sqlString(query.query)},
          ${sqlString(query.sourceType || "public_feed")},
          ${sqlString(query.provider || "news")},
          ${Number(query.weight || 3)},
          ${query.isActive === false ? 0 : 1},
          1,
          CURRENT_TIMESTAMP,
          1,
          CURRENT_TIMESTAMP
        );
      `);
    }

    await audit("persona.initialized", "persona", personaId, { personaId, queryCount: persona.queries.length });
    initialized.push(await getPersona(personaId));
  }

  return initialized;
}

async function resetPersonasForSetup(payload = {}) {
  if (payload.confirm !== "DELETE_PERSONAS" && process.env.RESET_PERSONAS_CONFIRM !== "YES") {
    throw validationError("reset requires confirm: DELETE_PERSONAS");
  }
  await execSql(`
    DELETE FROM velocity_alerts;
    DELETE FROM signal_snapshots WHERE signal_id IN (SELECT id FROM signals);
    DELETE FROM signals;
    DELETE FROM drafts;
    DELETE FROM scheduled_posts;
    DELETE FROM persona_queries;
    DELETE FROM platform_accounts;
    DELETE FROM personas;
  `);
  await audit("destructive_reset.executed", "persona", "all", { purpose: "first-run setup verification" });
  return getSetupStatus();
}

function normalizeQueryPayload(payload = {}, { partial = false } = {}) {
  const normalized = {};
  if (!partial || payload.query !== undefined) {
    normalized.query = String(payload.query || "").trim();
    if (!normalized.query) throw validationError("query is required");
  }
  if (!partial || payload.sourceType !== undefined) normalized.sourceType = String(payload.sourceType || "public_feed").trim() || "public_feed";
  if (!partial || payload.provider !== undefined) normalized.provider = normalizeProvider(payload.provider || "news");
  if (!partial || payload.weight !== undefined) normalized.weight = normalizeWeight(payload.weight || 1);
  if (payload.isActive !== undefined) normalized.isActive = Boolean(payload.isActive);
  return normalized;
}

async function getPersonaQuery(personaId, queryId) {
  const rows = await querySql(`
    SELECT *
    FROM persona_queries
    WHERE persona_id = ${sqlString(personaId)}
      AND id = ${sqlString(queryId)}
    LIMIT 1;
  `);
  return rows.length ? mapPersonaQuery(rows[0]) : null;
}

async function updatePersonaQuery(personaId, queryId, payload) {
  if (!(await getPersona(personaId))) return null;
  if (!(await getPersonaQuery(personaId, queryId))) return null;
  const query = normalizeQueryPayload(payload, { partial: true });
  await execSql(`
    UPDATE persona_queries
    SET
      query = COALESCE(${sqlString(query.query)}, query),
      source_type = COALESCE(${sqlString(query.sourceType)}, source_type),
      provider = COALESCE(${sqlString(query.provider)}, provider),
      weight = COALESCE(${query.weight === undefined ? "NULL" : query.weight}, weight),
      is_active = COALESCE(${query.isActive === undefined ? "NULL" : query.isActive ? 1 : 0}, is_active),
      user_edited = 1,
      user_edited_at = CURRENT_TIMESTAMP,
      locked_from_seed_overwrite = 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE persona_id = ${sqlString(personaId)} AND id = ${sqlString(queryId)};
  `);
  await audit("persona_query.updated", "persona_query", queryId, { personaId, queryId, fields: Object.keys(payload) });
  return getPersona(personaId);
}

async function togglePersonaQuery(personaId, queryId) {
  const existing = await getPersonaQuery(personaId, queryId);
  if (!existing) return null;
  await execSql(`
    UPDATE persona_queries
    SET is_active = ${existing.isActive ? 0 : 1},
        user_edited = 1,
        user_edited_at = CURRENT_TIMESTAMP,
        locked_from_seed_overwrite = 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE persona_id = ${sqlString(personaId)} AND id = ${sqlString(queryId)};
  `);
  await audit("persona_query.toggled", "persona_query", queryId, { personaId, queryId, isActive: !existing.isActive });
  return getPersona(personaId);
}

async function getHermesSettings() {
  const rows = await querySql("SELECT key, value FROM hermes_settings ORDER BY key;");
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    morningDigestEnabled: settings.morning_digest_enabled !== "false",
    velocityScanEnabled: settings.velocity_scan_enabled !== "false",
    middayBriefEnabled: settings.midday_brief_enabled !== "false",
    eveningScanEnabled: settings.evening_scan_enabled !== "false",
    simulationModeEnabled: settings.simulation_mode_enabled !== "false",
    archiveAfterDays: Number(settings.archive_after_days || 7)
  };
}

async function updateHermesSettings(payload) {
  const keyMap = {
    morningDigestEnabled: "morning_digest_enabled",
    velocityScanEnabled: "velocity_scan_enabled",
    middayBriefEnabled: "midday_brief_enabled",
    eveningScanEnabled: "evening_scan_enabled",
    simulationModeEnabled: "simulation_mode_enabled",
    archiveAfterDays: "archive_after_days"
  };
  for (const [inputKey, dbKey] of Object.entries(keyMap)) {
    if (payload[inputKey] !== undefined) {
      await execSql(`
        INSERT INTO hermes_settings (key, value, updated_at)
        VALUES (${sqlString(dbKey)}, ${sqlString(String(payload[inputKey]))}, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;
      `);
    }
  }
  await audit("hermes.settings.updated", "hermes_settings", "global", { fields: Object.keys(payload) });
  return getHermesSettings();
}

async function archiveOldSignals(days) {
  const archiveDays = Math.max(1, Number(days || (await getHermesSettings()).archiveAfterDays || 7));
  const candidates = await querySql(`
    SELECT id
    FROM signals
    WHERE status NOT IN ('archived', 'used', 'dismissed')
      AND datetime(last_seen_at) < datetime('now', '-${archiveDays} day');
  `);
  await execSql(`
    UPDATE signals
    SET status = 'archived'
    WHERE status NOT IN ('archived', 'used', 'dismissed')
      AND datetime(last_seen_at) < datetime('now', '-${archiveDays} day');
  `);
  await audit("signals.archived", "signal", "bulk", { count: candidates.length, archiveDays });
  return { archived: candidates.length, archiveDays };
}

async function getSignalHistory(signalId) {
  const signal = await getSignal(signalId);
  if (!signal) return null;
  const rows = await querySql(`
    SELECT *
    FROM signal_snapshots
    WHERE signal_id = ${sqlString(signalId)}
    ORDER BY captured_at ASC;
  `);
  return { signal, snapshots: rows.map(mapSnapshot) };
}

async function exportHermesState() {
  const [personas, recentSignals, settings] = await Promise.all([
    getPersonas({ includeInactiveQueries: true }),
    getSignals({ includeDismissed: true, limit: 50 }),
    getHermesSettings()
  ]);
  await audit("hermes_export_requested", "hermes_export", "state", {
    personaCount: personas.length,
    recentSignalCount: recentSignals.length,
    contractVersion: CONTRACT_VERSION
  });
  return {
    contractVersion: CONTRACT_VERSION,
    exportedAt: new Date().toISOString(),
    personas,
    personaQueries: personas.flatMap((persona) => (persona.queries || []).map((query) => ({ ...query, personaId: persona.id }))),
    recentSignals,
    hermesSettings: settings
  };
}

async function runInProcessHermesValidation(options = {}) {
  const validationId = options.validationId || `validation_${Date.now()}`;
  await audit("hermes_validation_started", "hermes_validation", validationId, options);
  const result = {
    exportReachable: false,
    importReachable: false,
    validationSignalCreated: false,
    validationId,
    importedSignalIds: [],
    errors: []
  };

  try {
    const exportState = await exportHermesState();
    result.exportReachable = true;
    const payload = buildValidationPayload(exportState, {
      validationId,
      provider: options.provider || process.env.HERMES_PROVIDER || "lmstudio",
      model: options.model || process.env.HERMES_MODEL || "qwen3.6-35b-a3b-mtp",
      endpoint: options.endpoint || process.env.HERMES_ENDPOINT || "http://localhost:1234/v1",
      jobName: options.jobName || "hermes-connectivity-validation"
    });
    const importResult = await importHermesPayload(payload);
    result.importReachable = true;
    result.importedSignalIds = importResult.importedSignalIds || [];
    result.validationSignalCreated = result.importedSignalIds.length > 0;
  } catch (error) {
    result.errors.push(error.message);
    await audit("hermes_validation_failed", "hermes_validation", validationId, { error: error.message });
  }

  return result;
}

async function getHermesHealth() {
  const settings = await getHermesSettings();
  const [lastHermesRun] = (await querySql(`
    SELECT *
    FROM ingestion_runs
    WHERE generated_by = 'Hermes'
    ORDER BY started_at DESC
    LIMIT 1;
  `)).map(mapIngestionRun);
  const [lastValidationRun] = (await querySql(`
    SELECT *
    FROM ingestion_runs
    WHERE run_type = 'validation_ping'
    ORDER BY started_at DESC
    LIMIT 1;
  `)).map(mapIngestionRun);
  const recentEvents = (await querySql(`
    SELECT *
    FROM audit_log
    WHERE action LIKE 'hermes%'
    ORDER BY created_at DESC
    LIMIT 10;
  `)).map(mapAudit);

  return {
    settings,
    lastHermesRun: lastHermesRun || null,
    lastValidationRun: lastValidationRun || null,
    lastValidationStatus: lastValidationRun?.status || null,
    lastProvider: lastValidationRun?.provider || null,
    lastModel: lastValidationRun?.model || null,
    lastEndpoint: lastValidationRun?.endpoint || null,
    recentHermesAuditEvents: recentEvents
  };
}

async function simulateHermesImport(runType = "morning_digest") {
  const personas = await getPersonas();
  const payload = buildHermesSimulationPayload(personas, runType);
  const result = await importHermesPayload(payload);
  return { ...result, payload };
}

async function runHermesProviderMorningDigest(payload = {}) {
  const allPersonas = await getPersonas();
  const personas = allPersonas.filter((persona) => persona.platformStatus === "active");
  const skippedPersonaIds = allPersonas
    .filter((persona) => persona.platformStatus !== "active")
    .map((persona) => persona.id);
  const recentTopicsByPersona = new Map();
  for (const persona of personas) {
    recentTopicsByPersona.set(
      persona.id,
      (await getSignalsForPersona(persona.id)).slice(0, 20).map((signal) => signal.topic)
    );
  }

  const result = await runProviderBackedMorningDigest({
    personas,
    recentTopicsByPersona,
    importPayload: importHermesPayload,
    options: payload
  });
  result.skippedPersonaIds = skippedPersonaIds;
  result.skippedPersonaCount = skippedPersonaIds.length;

  await execSql(`
    UPDATE ingestion_runs
    SET source_count = ${Number(result.sourceCount || 0)},
        candidate_count = ${Number(result.candidateCount || 0)},
        cluster_count = ${Number(result.clusterCount || 0)},
        signal_count = ${Number(result.signalCount || 0)},
        notes = ${sqlString(`Provider-backed Hermes morning digest: ${result.signalCount} signals from ${result.candidateCount} candidates`)},
        summary = ${sqlJson({
          version: "provider-backed-morning-digest-v1",
          providerNames: result.providerNames,
          staleFilteredCount: result.staleFilteredCount,
          mockFilteredCount: result.mockFilteredCount,
          missingDateFilteredCount: result.missingDateFilteredCount,
          freshCandidateCount: result.freshCandidateCount,
          dedupedCount: result.dedupedCount,
          skippedPersonaIds: result.skippedPersonaIds,
          skippedPersonaCount: result.skippedPersonaCount,
          topSignalsByPersona: result.topSignalsByPersona,
          attribution: result.attribution
        })}
    WHERE id = ${sqlString(result.runId)};
  `);
  await audit("hermes.provider_morning_digest.completed", "ingestion_run", result.runId, {
    providerNames: result.providerNames,
    candidateCount: result.candidateCount,
    signalCount: result.signalCount,
    skippedPersonaCount: result.skippedPersonaCount
  });
  return result;
}

function compactDigestSignal(signal) {
  return {
    topic: signal.topic,
    source: signal.source,
    publishedAt: signal.publishedAt || signal.firstSeenAt,
    firstSeenAt: signal.firstSeenAt,
    priorityScore: signal.priorityScore,
    evidenceUrls: signal.evidenceUrls || [],
    hermesProvider: signal.provider || signal.hermesProvider,
    hermesModel: signal.model || signal.hermesModel,
    hermesJobName: signal.jobName || signal.hermesJobName
  };
}

function compactDigestPersona(persona) {
  return {
    personaId: persona.personaId,
    summary: persona.summary,
    signalCount: persona.signalCount,
    signals: (persona.signals || []).map(compactDigestSignal)
  };
}

async function getLatestHermesProviderMorningDigest({ compact = false } = {}) {
  const rows = await querySql(`
    SELECT *
    FROM ingestion_runs
    WHERE generated_by = 'Hermes'
      AND run_type = 'morning_digest'
      AND summary LIKE '%provider-backed-morning-digest-v1%'
    ORDER BY started_at DESC
    LIMIT 1;
  `);
  if (!rows.length) {
    return {
      lastRunAt: null,
      status: "not_run",
      providerNames: [],
      candidateCount: 0,
      dedupedCount: 0,
      clusterCount: 0,
      signalCount: 0,
      topSignalsByPersona: [],
      attribution: null,
      errors: []
    };
  }
  const run = mapIngestionRun(rows[0]);
  const summary = parseJsonField(rows[0].summary, {});
  const topSignalsByPersona = summary.topSignalsByPersona || [];
  return {
    lastRunAt: run.completedAt || run.startedAt,
    status: run.status,
    providerNames: summary.providerNames || [],
    candidateCount: run.candidateCount,
    staleFilteredCount: summary.staleFilteredCount || 0,
    mockFilteredCount: summary.mockFilteredCount || 0,
    missingDateFilteredCount: summary.missingDateFilteredCount || 0,
    freshCandidateCount: summary.freshCandidateCount || 0,
    dedupedCount: summary.dedupedCount || 0,
    clusterCount: run.clusterCount,
    signalCount: run.signalCount,
    topSignalsByPersona: compact ? topSignalsByPersona.map(compactDigestPersona) : topSignalsByPersona,
    attribution: summary.attribution || {
      provider: run.provider,
      model: run.model,
      endpoint: run.endpoint,
      jobName: run.jobName
    },
    errors: run.errorMessage ? [run.errorMessage] : []
  };
}

async function bootstrapHermesMorningBriefing() {
  if (process.env.DISABLE_HERMES_BOOTSTRAP === "1") return;
  const settings = await getHermesSettings();
  if (!settings.simulationModeEnabled || !settings.morningDigestEnabled) return;
  const existing = await querySql(`
    SELECT id
    FROM ingestion_runs
    WHERE generated_by = 'Hermes'
      AND run_type = 'morning_digest'
      AND date(started_at) = date('now')
      AND status = 'completed'
    LIMIT 1;
  `);
  if (!existing.length) {
    await simulateHermesImport("morning_digest");
  }
}

async function runIngestion(payload = {}) {
  /*
    Future integration point:
    Hermes cron should call /api/hermes/import later. This route remains for public RSS/news ingestion.
    X API recent search and publishing remain future phases.
  */
  const now = new Date().toISOString();
  const runId = newId("run");
  const runType = payload.runType || (payload.useMockProviders ? "mock" : "manual");
  await execSql(`
    INSERT INTO ingestion_runs (
      id, run_type, status, started_at, signals_created,
      source_count, candidate_count, cluster_count, signal_count, notes, summary
    )
    VALUES (
      ${sqlString(runId)}, ${sqlString(runType)}, 'running', ${sqlString(now)}, 0,
      0, 0, 0, 0, ${sqlString(payload.useMockProviders ? "Phase 3 deterministic provider ingestion started" : "Phase 3 public RSS/news ingestion started")},
      'Ingestion started'
    );
  `);

  const personas = await getPersonas();
  const createdSignals = [];
  let candidateCount = 0;
  let clusterCount = 0;
  const sourceSet = new Set();

  try {
    for (const persona of personas) {
      const recentTopics = (await getSignalsForPersona(persona.id)).slice(0, 20).map((signal) => signal.topic);
      const result = await buildSignalsForPersona(persona, recentTopics, {
        forceMock: Boolean(payload.useMockProviders),
        ignoreProviderErrors: true,
        maxSignalsPerPersona: payload.maxSignalsPerPersona || 6
      });
      candidateCount += result.candidates.length;
      clusterCount += result.clusters.length;
      for (const candidate of result.candidates) sourceSet.add(candidate.source);

      for (const signal of result.signals) {
        const signalId = newId("sig");
        const snapshotId = newId("snap");
        const persistedSignal = { ...signal, id: signalId, status: "new" };

        await execSql(`
          INSERT INTO signals (
            id, persona_id, topic, source, query, first_seen_at, last_seen_at,
            velocity_score, relevance_score, novelty_score, freshness_score, risk_score,
            priority_score, source_count, cluster_id, status, suggested_angle, evidence_urls
          )
          VALUES (
            ${sqlString(persistedSignal.id)}, ${sqlString(persistedSignal.personaId)}, ${sqlString(persistedSignal.topic)},
            ${sqlString(persistedSignal.source)}, ${sqlString(persistedSignal.query)}, ${sqlString(persistedSignal.firstSeenAt)},
            ${sqlString(persistedSignal.lastSeenAt)}, ${persistedSignal.velocityScore}, ${persistedSignal.relevanceScore},
            ${persistedSignal.noveltyScore}, ${persistedSignal.freshnessScore}, ${persistedSignal.riskScore},
            ${persistedSignal.priorityScore}, ${persistedSignal.sourceCount}, ${sqlString(persistedSignal.clusterId)},
            'new', ${sqlString(persistedSignal.suggestedAngle)}, ${sqlJson(persistedSignal.evidenceUrls)}
          );

          INSERT INTO signal_snapshots (
            id, signal_id, ingestion_run_id, captured_at,
            velocity_score, relevance_score, novelty_score, freshness_score,
            priority_score, risk_score, source_count, cluster_id, raw_payload
          )
          VALUES (
            ${sqlString(snapshotId)}, ${sqlString(persistedSignal.id)}, ${sqlString(runId)}, ${sqlString(now)},
            ${persistedSignal.velocityScore}, ${persistedSignal.relevanceScore}, ${persistedSignal.noveltyScore},
            ${persistedSignal.freshnessScore}, ${persistedSignal.priorityScore}, ${persistedSignal.riskScore},
            ${persistedSignal.sourceCount}, ${sqlString(persistedSignal.clusterId)},
            ${sqlJson({ ...persistedSignal.rawCluster, priorityScore: persistedSignal.priorityScore, freshnessScore: persistedSignal.freshnessScore })}
          );
        `);

        createdSignals.push(persistedSignal);
      }
    }

    await execSql(`
      UPDATE ingestion_runs
      SET status = 'completed',
          completed_at = ${sqlString(new Date().toISOString())},
          signals_created = ${createdSignals.length},
          source_count = ${sourceSet.size},
          candidate_count = ${candidateCount},
          cluster_count = ${clusterCount},
          signal_count = ${createdSignals.length},
          notes = ${sqlString(`Collected ${candidateCount} candidates from ${sourceSet.size} sources, clustered into ${clusterCount} stories, created ${createdSignals.length} signals`)},
          summary = ${sqlString(`Created ${createdSignals.length} scored signals`)}
      WHERE id = ${sqlString(runId)};
    `);
    await audit("ingestion.completed", "ingestion_run", runId, {
      sourceCount: sourceSet.size,
      candidateCount,
      clusterCount,
      signalCount: createdSignals.length
    });
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

  return { runId, runType, sourceCount: sourceSet.size, candidateCount, clusterCount, signals: createdSignals };
}

async function generateDrafts(payload) {
  const personaId = payload.personaId;
  if (!personaId) {
    const error = new Error("personaId is required");
    error.status = 400;
    throw error;
  }

  const personas = await getPersonas();
  const persona = personas.find((item) => item.id === personaId);
  if (!persona) {
    const error = new Error("Persona not found");
    error.status = 404;
    throw error;
  }

  const sourceSignalIds = Array.isArray(payload.signalIds) ? payload.signalIds : [];
  const count = Math.max(2, Math.min(3, Number(payload.count || 3)));
  const sourceSignals = sourceSignalIds.length
    ? (await querySql(`SELECT * FROM signals WHERE id IN (${sourceSignalIds.map(sqlString).join(",")});`)).map(mapSignal)
    : (await getSignalsForPersona(personaId)).slice(0, 2);
  const draftSeeds = sourceSignals.length ? sourceSignals : [{ topic: persona.niche, suggestedAngle: persona.voiceTone }];
  const created = [];

  for (let index = 0; index < count; index += 1) {
    const seed = draftSeeds[index % draftSeeds.length];
    const draftId = newId("draft");
    const ids = sourceSignals.map((signal) => signal.id).filter(Boolean);
    const body = `${persona.name}: ${seed.topic}. ${seed.suggestedAngle || "A clean angle is ready for review."} (${index + 1}/${count})`;
    const hashtags = ["#NexusDraft", `#${persona.name.replaceAll(" ", "")}`];
    await execSql(`
      INSERT INTO drafts (
        id, persona_id, body, original_body, edited_body, platform,
        media_refs, hashtags, status, source_signal_ids
      )
      VALUES (
        ${sqlString(draftId)}, ${sqlString(personaId)}, ${sqlString(body)},
        ${sqlString(body)}, ${sqlString(body)}, ${sqlString(payload.platform || "x")},
        ${sqlJson([])}, ${sqlJson(hashtags)}, 'needs_review', ${sqlJson(ids)}
      );
    `);
    created.push({
      id: draftId,
      personaId,
      body,
      originalBody: body,
      editedBody: body,
      platform: payload.platform || "x",
      mediaRefs: [],
      hashtags,
      status: "needs_review",
      sourceSignalIds: ids
    });
  }

  await audit("draft.generated", "persona", personaId, { draftCount: created.length, sourceSignalIds });
  return created;
}

async function getDraft(draftId) {
  const rows = await querySql(`SELECT * FROM drafts WHERE id = ${sqlString(draftId)} LIMIT 1;`);
  return rows.length ? mapDraft(rows[0]) : null;
}

async function updateDraft(draftId, payload) {
  const existing = await getDraft(draftId);
  if (!existing) return null;
  await execSql(`
    UPDATE drafts
    SET
      edited_body = COALESCE(${sqlString(payload.editedBody ?? payload.body)}, edited_body),
      body = COALESCE(${sqlString(payload.editedBody ?? payload.body)}, body),
      platform = COALESCE(${sqlString(payload.platform)}, platform),
      status = COALESCE(${sqlString(payload.status)}, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${sqlString(draftId)};
  `);
  await audit("draft.edited", "draft", draftId, { fields: Object.keys(payload) });
  return getDraft(draftId);
}

async function setDraftStatus(draftId, status) {
  const existing = await getDraft(draftId);
  if (!existing) return null;
  await execSql(`
    UPDATE drafts
    SET status = ${sqlString(status)}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${sqlString(draftId)};
  `);
  if (status === "approved") {
    await markSignalsUsed(existing.sourceSignalIds);
    await audit("draft.approved", "draft", draftId, { sourceSignalIds: existing.sourceSignalIds });
  }
  if (status === "rejected") {
    await audit("draft.rejected", "draft", draftId, { sourceSignalIds: existing.sourceSignalIds });
  }
  return getDraft(draftId);
}

async function markSignalsUsed(signalIds) {
  if (!Array.isArray(signalIds) || !signalIds.length) return;
  const now = new Date().toISOString();
  await execSql(`
    UPDATE signals
    SET status = 'used', used_at = ${sqlString(now)}
    WHERE id IN (${signalIds.map(sqlString).join(",")});
  `);
}

async function regenerateDraft(draftId) {
  const existing = await getDraft(draftId);
  if (!existing) return null;
  const body = `${existing.originalBody} Refined for review at ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`;
  await execSql(`
    UPDATE drafts
    SET edited_body = ${sqlString(body)}, body = ${sqlString(body)}, status = 'needs_review', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${sqlString(draftId)};
  `);
  await audit("draft.regenerated", "draft", draftId);
  return getDraft(draftId);
}

async function createScheduledPost(payload) {
  const draftId = payload.draftId || null;
  let draft = null;
  if (draftId) {
    const rows = await querySql(`SELECT * FROM drafts WHERE id = ${sqlString(draftId)} LIMIT 1;`);
    draft = rows.length ? mapDraft(rows[0]) : null;
    if (!draft) {
      const error = new Error("Draft not found");
      error.status = 404;
      throw error;
    }
  }

  const post = {
    id: newId("post"),
    draftId,
    personaId: payload.personaId || draft?.personaId || null,
    platform: payload.platform || "x",
    body: payload.body || draft?.body || "Raw scheduled content",
    mediaRefs: payload.mediaRefs || draft?.mediaRefs || [],
    hashtags: payload.hashtags || draft?.hashtags || [],
    status: "scheduled",
    scheduledAt: payload.scheduledAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    sourceSignalIds: payload.sourceSignalIds || draft?.sourceSignalIds || []
  };

  await execSql(`
    INSERT INTO scheduled_posts (
      id, draft_id, persona_id, platform, body, media_refs, hashtags,
      status, scheduled_at, source_signal_ids
    )
    VALUES (
      ${sqlString(post.id)}, ${sqlString(post.draftId)}, ${sqlString(post.personaId)},
      ${sqlString(post.platform)}, ${sqlString(post.body)}, ${sqlJson(post.mediaRefs)},
      ${sqlJson(post.hashtags)}, 'scheduled', ${sqlString(post.scheduledAt)},
      ${sqlJson(post.sourceSignalIds)}
    );
  `);
  if (draftId) {
    await execSql(`UPDATE drafts SET status = 'scheduled', updated_at = CURRENT_TIMESTAMP WHERE id = ${sqlString(draftId)};`);
  }
  await markSignalsUsed(post.sourceSignalIds);
  await audit("post.scheduled", "scheduled_post", post.id, { draftId });
  return post;
}

async function updateScheduledPost(postId, payload) {
  const existing = await querySql(`SELECT * FROM scheduled_posts WHERE id = ${sqlString(postId)} LIMIT 1;`);
  if (!existing.length) return null;
  await execSql(`
    UPDATE scheduled_posts
    SET
      platform = COALESCE(${sqlString(payload.platform)}, platform),
      body = COALESCE(${sqlString(payload.body)}, body),
      scheduled_at = COALESCE(${sqlString(payload.scheduledAt)}, scheduled_at),
      status = COALESCE(${sqlString(payload.status)}, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${sqlString(postId)};
  `);
  const rows = await querySql(`SELECT * FROM scheduled_posts WHERE id = ${sqlString(postId)} LIMIT 1;`);
  return mapScheduledPost(rows[0]);
}

async function cancelScheduledPost(postId) {
  const updated = await updateScheduledPost(postId, { status: "cancelled" });
  if (updated) await audit("scheduled_post.cancelled", "scheduled_post", postId);
  return updated;
}

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, service: "persona-command-center", phase: 4 });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/setup/status") {
    sendJson(res, 200, await getSetupStatus());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/personas/initialize") {
    sendJson(res, 201, await initializePersonas(await readJson(req)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/setup/reset-personas") {
    sendJson(res, 200, await resetPersonasForSetup(await readJson(req)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/personas") {
    sendJson(res, 200, await getPersonas({ includeInactiveQueries: true }));
    return;
  }

  const personaGetMatch = url.pathname.match(/^\/api\/personas\/([^/]+)$/);
  if (req.method === "GET" && personaGetMatch) {
    const persona = await getPersona(personaGetMatch[1]);
    if (!persona) sendJson(res, 404, { error: "Persona not found" });
    else sendJson(res, 200, persona);
    return;
  }

  const personaUpdateMatch = url.pathname.match(/^\/api\/personas\/([^/]+)$/);
  if ((req.method === "POST" || req.method === "PATCH") && personaUpdateMatch) {
    const updated = await updatePersona(personaUpdateMatch[1], await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Persona not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const personaQueryMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/queries$/);
  if (req.method === "POST" && personaQueryMatch) {
    const updated = await addPersonaQuery(personaQueryMatch[1], await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Persona not found" });
    else sendJson(res, 201, updated);
    return;
  }

  const personaQueryPatchMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/queries\/([^/]+)$/);
  if (req.method === "PATCH" && personaQueryPatchMatch) {
    const updated = await updatePersonaQuery(personaQueryPatchMatch[1], personaQueryPatchMatch[2], await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Persona query not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const personaQueryToggleMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/queries\/([^/]+)\/toggle$/);
  if (req.method === "PATCH" && personaQueryToggleMatch) {
    const updated = await togglePersonaQuery(personaQueryToggleMatch[1], personaQueryToggleMatch[2]);
    if (!updated) sendJson(res, 404, { error: "Persona query not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const personaQueryDeleteMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/queries\/([^/]+)$/);
  if (req.method === "DELETE" && personaQueryDeleteMatch) {
    const updated = await deletePersonaQuery(personaQueryDeleteMatch[1], personaQueryDeleteMatch[2]);
    if (!updated) sendJson(res, 404, { error: "Persona not found" });
    else sendJson(res, 200, updated);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/signals/today") {
    sendJson(res, 200, await getTodaySignals());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/signals/archive") {
    sendJson(res, 200, await archiveOldSignals((await readJson(req)).days));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/signals") {
    sendJson(res, 200, await getSignals({
      personaId: url.searchParams.get("personaId"),
      status: url.searchParams.get("status"),
      sort: url.searchParams.get("sort"),
      includeDismissed: url.searchParams.get("includeDismissed") === "true",
      limit: url.searchParams.get("limit")
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/velocity-alerts") {
    sendJson(res, 200, await getVelocityAlerts({
      level: url.searchParams.get("level"),
      personaId: url.searchParams.get("personaId")
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/velocity/latest") {
    sendJson(res, 200, await getLatestVelocitySummary());
    return;
  }

  const signalPersonaMatch = url.pathname.match(/^\/api\/signals\/persona\/([^/]+)$/);
  if (req.method === "GET" && signalPersonaMatch) {
    sendJson(res, 200, await getSignalsForPersona(signalPersonaMatch[1]));
    return;
  }

  const signalPatchMatch = url.pathname.match(/^\/api\/signals\/([^/]+)$/);
  if (req.method === "PATCH" && signalPatchMatch) {
    const updated = await updateSignal(signalPatchMatch[1], await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Signal not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const signalHistoryMatch = url.pathname.match(/^\/api\/signals\/([^/]+)\/history$/);
  if (req.method === "GET" && signalHistoryMatch) {
    const history = await getSignalHistory(signalHistoryMatch[1]);
    if (!history) sendJson(res, 404, { error: "Signal not found" });
    else sendJson(res, 200, history);
    return;
  }

  const signalDismissMatch = url.pathname.match(/^\/api\/signals\/([^/]+)\/dismiss$/);
  if (req.method === "POST" && signalDismissMatch) {
    const updated = await updateSignal(signalDismissMatch[1], { status: "dismissed" });
    if (!updated) sendJson(res, 404, { error: "Signal not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const signalReviewedMatch = url.pathname.match(/^\/api\/signals\/([^/]+)\/mark-reviewed$/);
  if (req.method === "POST" && signalReviewedMatch) {
    const updated = await updateSignal(signalReviewedMatch[1], { status: "reviewed" });
    if (!updated) sendJson(res, 404, { error: "Signal not found" });
    else sendJson(res, 200, updated);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ingestion/run") {
    sendJson(res, 201, await runIngestion(await readJson(req)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/hermes/import") {
    sendJson(res, 201, await importHermesPayload(await readJson(req)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/hermes/export") {
    sendJson(res, 200, await exportHermesState());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/hermes/validate") {
    sendJson(res, 200, await runInProcessHermesValidation(await readJson(req)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/hermes/health") {
    sendJson(res, 200, await getHermesHealth());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/hermes/morning-digest/run") {
    sendJson(res, 201, await runHermesProviderMorningDigest(await readJson(req)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/hermes/morning-digest/latest") {
    sendJson(res, 200, await getLatestHermesProviderMorningDigest({
      compact: url.searchParams.get("compact") === "true"
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/hermes/simulate") {
    const payload = await readJson(req);
    sendJson(res, 201, await simulateHermesImport(payload.runType || "morning_digest"));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/hermes/settings") {
    sendJson(res, 200, await getHermesSettings());
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/hermes/settings") {
    sendJson(res, 200, await updateHermesSettings(await readJson(req)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ingestion/runs") {
    const rows = await querySql("SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 30;");
    sendJson(res, 200, rows.map(mapIngestionRun));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/drafts") {
    const rows = await querySql("SELECT * FROM drafts ORDER BY created_at DESC LIMIT 50;");
    sendJson(res, 200, rows.map(mapDraft));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/drafts/generate") {
    sendJson(res, 201, await generateDrafts(await readJson(req)));
    return;
  }

  const draftPatchMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)$/);
  if (req.method === "PATCH" && draftPatchMatch) {
    const updated = await updateDraft(draftPatchMatch[1], await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Draft not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const draftApproveMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/approve$/);
  if (req.method === "POST" && draftApproveMatch) {
    const updated = await setDraftStatus(draftApproveMatch[1], "approved");
    if (!updated) sendJson(res, 404, { error: "Draft not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const draftRejectMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/reject$/);
  if (req.method === "POST" && draftRejectMatch) {
    const updated = await setDraftStatus(draftRejectMatch[1], "rejected");
    if (!updated) sendJson(res, 404, { error: "Draft not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const draftRegenMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/regenerate$/);
  if (req.method === "POST" && draftRegenMatch) {
    const updated = await regenerateDraft(draftRegenMatch[1]);
    if (!updated) sendJson(res, 404, { error: "Draft not found" });
    else sendJson(res, 200, updated);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/schedule") {
    const rows = await querySql("SELECT * FROM scheduled_posts ORDER BY scheduled_at ASC LIMIT 50;");
    sendJson(res, 200, rows.map(mapScheduledPost));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/schedule") {
    sendJson(res, 201, await createScheduledPost(await readJson(req)));
    return;
  }

  const schedulePatchMatch = url.pathname.match(/^\/api\/schedule\/([^/]+)$/);
  if (req.method === "PATCH" && schedulePatchMatch) {
    const updated = await updateScheduledPost(schedulePatchMatch[1], await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Scheduled post not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const scheduleCancelMatch = url.pathname.match(/^\/api\/schedule\/([^/]+)\/cancel$/);
  if (req.method === "POST" && scheduleCancelMatch) {
    const updated = await cancelScheduledPost(scheduleCancelMatch[1]);
    if (!updated) sendJson(res, 404, { error: "Scheduled post not found" });
    else sendJson(res, 200, updated);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/audit-log") {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 50)));
    const rows = await querySql(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ${limit};`);
    sendJson(res, 200, rows.map(mapAudit));
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function routeStatic(_req, res, url) {
  if (url.pathname === "/" || url.pathname === "/persona-command-center.html") {
    const html = await readFile(path.join(rootDir, "outputs", "persona-command-center.html"), "utf8");
    sendText(res, 200, html, "text/html; charset=utf-8", {
      "x-pcc-frontend-build": "persona-api-connected-v2"
    });
    return;
  }

  sendText(res, 404, "Not found");
}

export async function createAppServer() {
  await initDb();
  await bootstrapHermesMorningBriefing();
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "OPTIONS") {
        sendText(res, 204, "");
        return;
      }
      if (url.pathname.startsWith("/api/")) await routeApi(req, res, url);
      else await routeStatic(req, res, url);
    } catch (error) {
      const status = error.status || 500;
      sendJson(res, status, { error: error.message || "Internal server error" });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await createAppServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Persona Command Center running at http://127.0.0.1:${port}`);
  });
}
