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
  sqlString,
  dbPath
} from "./db.js";
import { buildSignalsForPersona } from "./ingestion/pipeline.js";
import { importHermesPayload } from "./hermes/hermesImport.js";
import { buildHermesSimulationPayload } from "./hermes/hermesJobs.js";
import { runProviderBackedMorningDigest } from "./hermes/providerMorningDigest.js";
import { buildValidationPayload, CONTRACT_VERSION } from "./hermes/validationJob.js";
import { getLatestVelocitySummary, getVelocityAlerts } from "./velocity/alertEngine.js";
import { getProvider, listProviders } from "./providers/index.js";
import { getDefaultProviders } from "../config/defaultProviders.js";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const port = Number(process.env.PORT || 3000);
const activeRequests = new Set();
const startTime = Date.now();

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
  const voiceControls = normalizeVoiceControls(parseJsonField(row.voice_controls, null), row.id);
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    account: row.handle,
    niche: row.niche,
    voiceTone: row.voice_tone,
    voiceControls,
    platformStatus: row.platform_status,
    userEdited: Boolean(row.user_edited),
    userEditedAt: row.user_edited_at,
    lockedFromSeedOverwrite: Boolean(row.locked_from_seed_overwrite),
    queries
  };
}

const VOICE_CONTROL_KEYS = [
  "humorLevel",
  "contrarianLevel",
  "explainerLevel",
  "punchinessLevel",
  "memeLevel",
  "technicalDepth",
  "emotionalIntensity",
  "riskTolerance",
  "formalityLevel"
];

const VOICE_LEVELS = new Set(["low", "medium", "high"]);

const DEFAULT_VOICE_CONTROLS = {
  "the-wonkette": {
    humorLevel: "medium",
    contrarianLevel: "medium",
    explainerLevel: "high",
    punchinessLevel: "medium",
    memeLevel: "low",
    technicalDepth: "high",
    emotionalIntensity: "low",
    riskTolerance: "low",
    formalityLevel: "medium"
  },
  "policy-pete": {
    humorLevel: "low",
    contrarianLevel: "low",
    explainerLevel: "high",
    punchinessLevel: "medium",
    memeLevel: "low",
    technicalDepth: "high",
    emotionalIntensity: "low",
    riskTolerance: "low",
    formalityLevel: "high"
  },
  "maga-memester": {
    humorLevel: "high",
    contrarianLevel: "high",
    explainerLevel: "low",
    punchinessLevel: "high",
    memeLevel: "high",
    technicalDepth: "low",
    emotionalIntensity: "medium",
    riskTolerance: "medium",
    formalityLevel: "low"
  },
  "progressive-pat": {
    humorLevel: "low",
    contrarianLevel: "medium",
    explainerLevel: "medium",
    punchinessLevel: "medium",
    memeLevel: "low",
    technicalDepth: "medium",
    emotionalIntensity: "high",
    riskTolerance: "medium",
    formalityLevel: "medium"
  }
};

function normalizeVoiceControls(value = {}, personaId = "") {
  const defaults = DEFAULT_VOICE_CONTROLS[personaId] || {
    humorLevel: "medium",
    contrarianLevel: "medium",
    explainerLevel: "medium",
    punchinessLevel: "medium",
    memeLevel: "low",
    technicalDepth: "medium",
    emotionalIntensity: "medium",
    riskTolerance: "medium",
    formalityLevel: "medium"
  };
  const source = value && typeof value === "object" ? value : {};
  const normalized = {};
  for (const key of VOICE_CONTROL_KEYS) {
    const level = String(source[key] || defaults[key] || "medium").toLowerCase();
    normalized[key] = VOICE_LEVELS.has(level) ? level : "medium";
  }
  return normalized;
}

function mapPersonaQuery(row) {
  return {
    id: row.id,
    personaId: row.persona_id,
    query: row.query,
    sourceType: row.source_type,
    provider: row.provider || row.source_type || (getDefaultProviders()[0] || "rss"),
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
    testMode: Boolean(row.test_mode),
    reviewedAt: row.reviewed_at,
    reviewReason: row.review_reason,
    dismissedAt: row.dismissed_at,
    dismissalReason: row.dismissal_reason,
    usedAt: row.used_at,
    suggestedAngle: row.suggested_angle,
    editorialMetadata: parseJsonField(row.editorial_metadata, {}),
    evidenceUrls: parseJsonField(row.evidence_urls, [])
  };
}

const BANNED_TEMPLATE_PHRASES = [
  "frame \"",
  "write a post",
  "draft a",
  "template:",
  "[insert",
  "{{",
  "copy goes here"
];

const OPERATOR_NOISE_PATTERNS = [
  "mock",
  "demo",
  "smoke",
  "verification",
  "trial",
  "validation",
  "hermes.local",
  "example",
  "searchagent unavailable",
  "new opportunity detected",
  "crawl4ai mock"
];

function lowerText(value) {
  return String(value || "").toLowerCase();
}

function isProductionNoiseSignal(signal = {}) {
  const evidenceText = Array.isArray(signal.evidenceUrls)
    ? signal.evidenceUrls.join(" ")
    : String(signal.evidenceUrls || "");
  const haystack = [
    signal.topic,
    signal.source,
    signal.sourceProvider,
    signal.hermesProvider,
    signal.hermesModel,
    signal.hermesEndpoint,
    signal.hermesJobName,
    signal.hermesRunType,
    signal.query,
    evidenceText
  ].map(lowerText).join(" ");
  return signal.testMode === true || OPERATOR_NOISE_PATTERNS.some((pattern) => haystack.includes(pattern));
}

function productionSignalSqlFilter() {
  const textColumns = [
    "LOWER(COALESCE(topic, ''))",
    "LOWER(COALESCE(source, ''))",
    "LOWER(COALESCE(source_provider, ''))",
    "LOWER(COALESCE(hermes_provider, ''))",
    "LOWER(COALESCE(hermes_model, ''))",
    "LOWER(COALESCE(hermes_endpoint, ''))",
    "LOWER(COALESCE(hermes_job_name, ''))",
    "LOWER(COALESCE(hermes_run_type, ''))",
    "LOWER(COALESCE(query, ''))",
    "LOWER(COALESCE(evidence_urls, ''))"
  ];
  const clauses = ["(test_mode IS NULL OR test_mode = 0)"];
  for (const pattern of OPERATOR_NOISE_PATTERNS) {
    const escaped = pattern.replaceAll("'", "''");
    clauses.push(`NOT (${textColumns.map((column) => `${column} LIKE '%${escaped}%'`).join(" OR ")})`);
  }
  return clauses.join(" AND ");
}

function evaluateXDraftQuality(body = "") {
  const text = String(body || "");
  const warnings = [];
  const errors = [];
  if (!text.trim()) errors.push("Draft body is empty.");
  if (text.length > 280) errors.push(`Draft is ${text.length} characters; X posts should stay at or below 280 characters.`);
  if (text.length > 250 && text.length <= 280) warnings.push(`Draft is ${text.length} characters; little room remains for edits.`);
  if (/https?:\/\/\S+/i.test(text)) warnings.push("Draft contains a link; verify the URL before manual posting.");
  if ((text.match(/#/g) || []).length > 3) warnings.push("Draft uses more than three hashtags.");
  if (/\b(breaking|exclusive|confirmed)\b/i.test(text)) warnings.push("Draft uses a high-claim term; confirm evidence before posting.");
  for (const phrase of BANNED_TEMPLATE_PHRASES) {
    if (text.toLowerCase().includes(phrase)) {
      errors.push(`Draft contains banned template phrase: ${phrase}`);
    }
  }
  return {
    platform: "x",
    characterCount: text.length,
    maxCharacters: 280,
    withinLimit: text.length <= 280,
    hasText: Boolean(text.trim()),
    warnings,
    errors,
    passed: errors.length === 0
  };
}

function mapDraft(row) {
  const body = row.edited_body || row.body;
  const storedQuality = parseJsonField(row.quality_checks, null);
  return {
    id: row.id,
    personaId: row.persona_id,
    body,
    originalBody: row.original_body || row.body,
    editedBody: body,
    platform: row.platform || "x",
    mediaRefs: parseJsonField(row.media_refs, []),
    hashtags: parseJsonField(row.hashtags, []),
    status: row.status,
    reviewReason: row.review_reason,
    rejectionReason: row.rejection_reason,
    qualityChecks: storedQuality || evaluateXDraftQuality(body),
    editorialMetadata: parseJsonField(row.editorial_metadata, {}),
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

function mapPublishedPost(row) {
  return {
    id: row.id,
    scheduledPostId: row.scheduled_post_id,
    draftId: row.draft_id,
    personaId: row.persona_id,
    platform: row.platform || "x",
    externalPostId: row.external_post_id,
    publishedUrl: row.published_url,
    body: row.body,
    mediaRefs: parseJsonField(row.media_refs, []),
    hashtags: parseJsonField(row.hashtags, []),
    status: row.status || "published_manual",
    publishedAt: row.published_at,
    sourceSignalIds: parseJsonField(row.source_signal_ids, []),
    performance: {
      impressions: Number(row.impressions || 0),
      likes: Number(row.likes || 0),
      reposts: Number(row.reposts || 0),
      replies: Number(row.replies || 0),
      bookmarks: Number(row.bookmarks || 0),
      notes: row.engagement_notes,
      updatedAt: row.performance_updated_at
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapOperatorDraftChoice(row) {
  return {
    id: row.id,
    personaId: row.persona_id,
    signalId: row.signal_id,
    sourceSignalIds: parseJsonField(row.source_signal_ids, []),
    draftA: row.draft_a,
    draftB: row.draft_b,
    selectedVariant: row.selected_variant,
    editedFinalText: row.edited_final_text,
    choiceReason: row.choice_reason,
    outcome: row.outcome,
    scheduledPostId: row.scheduled_post_id,
    publishedPostId: row.published_post_id,
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

export async function getPersonas({ includeInactiveQueries = false } = {}) {
  const personas = await querySql("SELECT * FROM personas ORDER BY rowid;");
  const queries = await querySql(`
    SELECT *
    FROM persona_queries
    ${includeInactiveQueries ? "" : "WHERE is_active = 1"}
    ORDER BY rowid;
  `);
  const enriched = [];
  for (const persona of personas) {
    const p = mapPersona(
      persona,
      queries.filter((query) => query.persona_id === persona.id).map(mapPersonaQuery)
    );
    p.interests = await getPersonaInterests(p.id);
    p.trackedEntities = await getPersonaEntitySubscriptions(p.id);
    p.crawlTargets = await getPersonaCrawlTargets(p.id);
    p.rssTopics = await getPersonaRssTopics(p.id);
    enriched.push(p);
  }
  return enriched;
}

async function getPersonaById(personaId, { includeInactiveQueries = true } = {}) {
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
  const persona = mapPersona(personas[0], queries.map(mapPersonaQuery));
  persona.interests = await getPersonaInterests(persona.id);
  persona.trackedEntities = await getPersonaEntitySubscriptions(persona.id);
  persona.crawlTargets = await getPersonaCrawlTargets(persona.id);
  persona.rssTopics = await getPersonaRssTopics(persona.id);
  return persona;
}

async function getPersona(personaId, options = {}) {
  return getPersonaById(personaId, options);
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
  if (filters.excludeTestMode) clauses.push(productionSignalSqlFilter());
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
      AND (test_mode IS NULL OR test_mode = 0)
    ORDER BY priority_score DESC, last_seen_at DESC, relevance_score DESC
    LIMIT 30;
  `);
  return rows.map(mapSignal);
}

async function getPersonaInterests(personaId) {
  return querySql(`SELECT * FROM persona_interests WHERE persona_id = ${sqlString(personaId)} ORDER BY weight DESC, label ASC;`);
}

async function getPersonaEntitySubscriptions(personaId) {
  return querySql(`
    SELECT pes.*, te.name AS entity_name, te.type AS entity_type, te.primary_x_handle
    FROM persona_entity_subscriptions pes
    JOIN tracked_entities te ON te.id = pes.entity_id
    WHERE pes.persona_id = ${sqlString(personaId)}
    ORDER BY pes.priority DESC, te.name ASC;
  `);
}

async function getPersonaCrawlTargets(personaId) {
  return querySql(`SELECT * FROM persona_crawl_targets WHERE persona_id = ${sqlString(personaId)} ORDER BY created_at DESC;`);
}

async function getPersonaRssTopics(personaId) {
  return querySql(`SELECT * FROM persona_rss_topics WHERE persona_id = ${sqlString(personaId)} ORDER BY weight DESC, topic ASC;`);
}

// ---- Persona Interests CRUD ----
export async function createPersonaInterest(personaId, payload) {
  const id = newId("int");
  await execSql(`
    INSERT INTO persona_interests (id, persona_id, label, weight, is_active)
    VALUES (${sqlString(id)}, ${sqlString(personaId)}, ${sqlString(payload.label)}, ${Number(payload.weight || 1)}, 1);
  `);
  await audit("interest.created", "persona_interest", id, { personaId, label: payload.label });
  const rows = await querySql(`SELECT * FROM persona_interests WHERE id = ${sqlString(id)};`);
  return rows[0] || null;
}

async function updatePersonaInterest(interestId, payload) {
  const sets = [];
  if (payload.label !== undefined) sets.push(`label = ${sqlString(payload.label)}`);
  if (payload.weight !== undefined) sets.push(`weight = ${Number(payload.weight)}`);
  if (payload.is_active !== undefined) sets.push(`is_active = ${Number(payload.is_active)}`);
  if (!sets.length) return null;
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  await execSql(`UPDATE persona_interests SET ${sets.join(", ")} WHERE id = ${sqlString(interestId)};`);
  await audit("interest.updated", "persona_interest", interestId, { updates: Object.keys(payload) });
  const rows = await querySql(`SELECT * FROM persona_interests WHERE id = ${sqlString(interestId)};`);
  return rows[0] || null;
}

export async function deletePersonaInterest(interestId) {
  const rows = await querySql(`SELECT * FROM persona_interests WHERE id = ${sqlString(interestId)} LIMIT 1;`);
  if (rows.length) {
    await execSql(`
      INSERT INTO persona_interest_deletions (interest_id, persona_id, label, deleted_at)
      VALUES (${sqlString(interestId)}, ${sqlString(rows[0].persona_id)}, ${sqlString(rows[0].label)}, CURRENT_TIMESTAMP)
      ON CONFLICT(interest_id) DO UPDATE SET
        persona_id = excluded.persona_id,
        label = excluded.label,
        deleted_at = CURRENT_TIMESTAMP;
    `);
  }
  await execSql(`DELETE FROM persona_interests WHERE id = ${sqlString(interestId)};`);
  await audit("interest.deleted", "persona_interest", interestId, { personaId: rows[0]?.persona_id || null, label: rows[0]?.label || null });
  return { deleted: true };
}

// ---- Global Tracked Entities CRUD ----
async function getTrackedEntities() {
  return querySql(`SELECT * FROM tracked_entities WHERE is_active = 1 ORDER BY name ASC;`);
}

async function createTrackedEntity(payload) {
  const id = newId("ent");
  await execSql(`
    INSERT INTO tracked_entities (id, name, type, primary_x_handle, aliases_json, github_urls_json, website_urls_json, rss_urls_json, keywords_json, notes)
    VALUES (
      ${sqlString(id)}, ${sqlString(payload.name)}, ${sqlString(payload.type || "person")},
      ${sqlString(payload.primaryXHandle || payload.primary_x_handle || null)},
      ${sqlJson(payload.aliases || [])}, ${sqlJson(payload.githubUrls || payload.github_urls || [])},
      ${sqlJson(payload.websiteUrls || payload.website_urls || [])},
      ${sqlJson(payload.rssUrls || payload.rss_urls || [])},
      ${sqlJson(payload.keywords || [])}, ${sqlString(payload.notes || null)}
    );
  `);
  await audit("entity.created", "tracked_entity", id, { name: payload.name, type: payload.type });
  const rows = await querySql(`SELECT * FROM tracked_entities WHERE id = ${sqlString(id)};`);
  return rows[0] || null;
}

async function updateTrackedEntity(entityId, payload) {
  const sets = [];
  if (payload.name !== undefined) sets.push(`name = ${sqlString(payload.name)}`);
  if (payload.type !== undefined) sets.push(`type = ${sqlString(payload.type)}`);
  if (payload.primaryXHandle !== undefined || payload.primary_x_handle !== undefined) sets.push(`primary_x_handle = ${sqlString(payload.primaryXHandle || payload.primary_x_handle || null)}`);
  if (payload.aliases !== undefined) sets.push(`aliases_json = ${sqlJson(payload.aliases)}`);
  if (payload.githubUrls !== undefined || payload.github_urls !== undefined) sets.push(`github_urls_json = ${sqlJson(payload.githubUrls || payload.github_urls || [])}`);
  if (payload.websiteUrls !== undefined || payload.website_urls !== undefined) sets.push(`website_urls_json = ${sqlJson(payload.websiteUrls || payload.website_urls || [])}`);
  if (payload.rssUrls !== undefined || payload.rss_urls !== undefined) sets.push(`rss_urls_json = ${sqlJson(payload.rssUrls || payload.rss_urls || [])}`);
  if (payload.keywords !== undefined) sets.push(`keywords_json = ${sqlJson(payload.keywords)}`);
  if (payload.notes !== undefined) sets.push(`notes = ${sqlString(payload.notes)}`);
  if (payload.is_active !== undefined) sets.push(`is_active = ${Number(payload.is_active)}`);
  if (!sets.length) return null;
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  await execSql(`UPDATE tracked_entities SET ${sets.join(", ")} WHERE id = ${sqlString(entityId)};`);
  await audit("entity.updated", "tracked_entity", entityId, { updates: Object.keys(payload) });
  const rows = await querySql(`SELECT * FROM tracked_entities WHERE id = ${sqlString(entityId)};`);
  return rows[0] || null;
}

async function deleteTrackedEntity(entityId) {
  await execSql(`DELETE FROM tracked_entities WHERE id = ${sqlString(entityId)};`);
  await audit("entity.deleted", "tracked_entity", entityId, {});
  return { deleted: true };
}

// ---- Persona Entity Subscriptions CRUD ----
async function createPersonaEntitySubscription(personaId, payload) {
  const id = newId("sub");
  await execSql(`
    INSERT INTO persona_entity_subscriptions (id, persona_id, entity_id, priority, monitor_x, monitor_mentions, monitor_rss, monitor_crawl4ai, monitor_searchagent)
    VALUES (
      ${sqlString(id)}, ${sqlString(personaId)}, ${sqlString(payload.entityId || payload.entity_id)},
      ${Number(payload.priority || 5)}, ${Number(payload.monitorX ?? payload.monitor_x ?? 1)},
      ${Number(payload.monitorMentions ?? payload.monitor_mentions ?? 1)},
      ${Number(payload.monitorRss ?? payload.monitor_rss ?? 1)},
      ${Number(payload.monitorCrawl4ai ?? payload.monitor_crawl4ai ?? 1)},
      ${Number(payload.monitorSearchagent ?? payload.monitor_searchagent ?? 1)}
    );
  `);
  await audit("entity.subscription.created", "persona_entity_subscription", id, { personaId, entityId: payload.entityId || payload.entity_id });
  return querySql(`SELECT pes.*, te.name AS entity_name, te.type AS entity_type, te.primary_x_handle FROM persona_entity_subscriptions pes JOIN tracked_entities te ON te.id = pes.entity_id WHERE pes.id = ${sqlString(id)};`);
}

async function updatePersonaEntitySubscription(subscriptionId, payload) {
  const sets = [];
  if (payload.priority !== undefined) sets.push(`priority = ${Number(payload.priority)}`);
  if (payload.is_active !== undefined) sets.push(`is_active = ${Number(payload.is_active)}`);
  if (payload.monitorX !== undefined || payload.monitor_x !== undefined) sets.push(`monitor_x = ${Number(payload.monitorX ?? payload.monitor_x ?? 1)}`);
  if (payload.monitorMentions !== undefined || payload.monitor_mentions !== undefined) sets.push(`monitor_mentions = ${Number(payload.monitorMentions ?? payload.monitor_mentions ?? 1)}`);
  if (payload.monitorRss !== undefined || payload.monitor_rss !== undefined) sets.push(`monitor_rss = ${Number(payload.monitorRss ?? payload.monitor_rss ?? 1)}`);
  if (payload.monitorCrawl4ai !== undefined || payload.monitor_crawl4ai !== undefined) sets.push(`monitor_crawl4ai = ${Number(payload.monitorCrawl4ai ?? payload.monitor_crawl4ai ?? 1)}`);
  if (payload.monitorSearchagent !== undefined || payload.monitor_searchagent !== undefined) sets.push(`monitor_searchagent = ${Number(payload.monitorSearchagent ?? payload.monitor_searchagent ?? 1)}`);
  if (!sets.length) return null;
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  await execSql(`UPDATE persona_entity_subscriptions SET ${sets.join(", ")} WHERE id = ${sqlString(subscriptionId)};`);
  await audit("entity.subscription.updated", "persona_entity_subscription", subscriptionId, { updates: Object.keys(payload) });
  return querySql(`SELECT pes.*, te.name AS entity_name, te.type AS entity_type, te.primary_x_handle FROM persona_entity_subscriptions pes JOIN tracked_entities te ON te.id = pes.entity_id WHERE pes.id = ${sqlString(subscriptionId)};`);
}

async function deletePersonaEntitySubscription(subscriptionId) {
  await execSql(`DELETE FROM persona_entity_subscriptions WHERE id = ${sqlString(subscriptionId)};`);
  await audit("entity.subscription.deleted", "persona_entity_subscription", subscriptionId, {});
  return { deleted: true };
}

// ---- Persona Crawl Targets CRUD ----
async function createPersonaCrawlTarget(personaId, payload) {
  const id = newId("crawl");
  await execSql(`
    INSERT INTO persona_crawl_targets (id, persona_id, label, url, notes, frequency)
    VALUES (
      ${sqlString(id)}, ${sqlString(personaId)}, ${sqlString(payload.label || null)},
      ${sqlString(payload.url)}, ${sqlString(payload.notes || null)}, ${sqlString(payload.frequency || "daily")}
    );
  `);
  await audit("crawl_target.created", "persona_crawl_target", id, { personaId, url: payload.url });
  const rows = await querySql(`SELECT * FROM persona_crawl_targets WHERE id = ${sqlString(id)};`);
  return rows[0] || null;
}

async function updatePersonaCrawlTarget(targetId, payload) {
  const sets = [];
  if (payload.label !== undefined) sets.push(`label = ${sqlString(payload.label)}`);
  if (payload.url !== undefined) sets.push(`url = ${sqlString(payload.url)}`);
  if (payload.notes !== undefined) sets.push(`notes = ${sqlString(payload.notes)}`);
  if (payload.frequency !== undefined) sets.push(`frequency = ${sqlString(payload.frequency)}`);
  if (payload.is_active !== undefined) sets.push(`is_active = ${Number(payload.is_active)}`);
  if (!sets.length) return null;
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  await execSql(`UPDATE persona_crawl_targets SET ${sets.join(", ")} WHERE id = ${sqlString(targetId)};`);
  await audit("crawl_target.updated", "persona_crawl_target", targetId, { updates: Object.keys(payload) });
  const rows = await querySql(`SELECT * FROM persona_crawl_targets WHERE id = ${sqlString(targetId)};`);
  return rows[0] || null;
}

async function deletePersonaCrawlTarget(targetId) {
  await execSql(`DELETE FROM persona_crawl_targets WHERE id = ${sqlString(targetId)};`);
  await audit("crawl_target.deleted", "persona_crawl_target", targetId, {});
  return { deleted: true };
}

// ---- Persona RSS Topics CRUD ----
async function createPersonaRssTopic(personaId, payload) {
  const id = newId("rt");
  await execSql(`
    INSERT INTO persona_rss_topics (id, persona_id, topic, provider, weight)
    VALUES (
      ${sqlString(id)}, ${sqlString(personaId)}, ${sqlString(payload.topic)},
      ${sqlString(payload.provider || "rss")}, ${Number(payload.weight || 1)}
    );
  `);
  await audit("rss_topic.created", "persona_rss_topic", id, { personaId, topic: payload.topic, provider: payload.provider });
  const rows = await querySql(`SELECT * FROM persona_rss_topics WHERE id = ${sqlString(id)};`);
  return rows[0] || null;
}

async function updatePersonaRssTopic(topicId, payload) {
  const sets = [];
  if (payload.topic !== undefined) sets.push(`topic = ${sqlString(payload.topic)}`);
  if (payload.provider !== undefined) sets.push(`provider = ${sqlString(payload.provider)}`);
  if (payload.weight !== undefined) sets.push(`weight = ${Number(payload.weight)}`);
  if (payload.is_active !== undefined) sets.push(`is_active = ${Number(payload.is_active)}`);
  if (!sets.length) return null;
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  await execSql(`UPDATE persona_rss_topics SET ${sets.join(", ")} WHERE id = ${sqlString(topicId)};`);
  await audit("rss_topic.updated", "persona_rss_topic", topicId, { updates: Object.keys(payload) });
  const rows = await querySql(`SELECT * FROM persona_rss_topics WHERE id = ${sqlString(topicId)};`);
  return rows[0] || null;
}

async function deletePersonaRssTopic(topicId) {
  await execSql(`DELETE FROM persona_rss_topics WHERE id = ${sqlString(topicId)};`);
  await audit("rss_topic.deleted", "persona_rss_topic", topicId, {});
  return { deleted: true };
}

async function getSignal(signalId) {
  const rows = await querySql(`SELECT * FROM signals WHERE id = ${sqlString(signalId)} LIMIT 1;`);
  return rows.length ? mapSignal(rows[0]) : null;
}

async function updateSignal(signalId, payload, options = {}) {
  const existing = await getSignal(signalId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const status = payload.status || existing.status;
  if (payload.status && !options.allowLifecycleStatus && payload.status !== "new" && payload.status !== existing.status) {
    throw validationError("Use the explicit signal review, dismiss, archive, or publish workflow endpoint for status changes.");
  }
  const reviewedAt = status === "reviewed" ? now : existing.reviewedAt;
  const dismissedAt = status === "dismissed" ? now : existing.dismissedAt;
  const usedAt = status === "used" ? now : existing.usedAt;
  const reviewReason = status === "reviewed" ? (payload.reviewReason ?? payload.reason ?? existing.reviewReason) : existing.reviewReason;
  const dismissalReason = status === "dismissed" ? (payload.dismissalReason ?? payload.reason ?? existing.dismissalReason) : existing.dismissalReason;

  await execSql(`
    UPDATE signals
    SET
      status = ${sqlString(status)},
      reviewed_at = ${sqlString(reviewedAt)},
      review_reason = ${sqlString(reviewReason)},
      dismissed_at = ${sqlString(dismissedAt)},
      dismissal_reason = ${sqlString(dismissalReason)},
      used_at = ${sqlString(usedAt)},
      last_seen_at = COALESCE(${sqlString(payload.lastSeenAt)}, last_seen_at)
    WHERE id = ${sqlString(signalId)};
  `);
  if (status === "dismissed") await audit("signal.dismissed", "signal", signalId, { reason: payload.dismissalReason ?? payload.reason ?? null });
  if (status === "reviewed") await audit("signal.reviewed", "signal", signalId, { reason: payload.reviewReason ?? payload.reason ?? null });
  return getSignal(signalId);
}

export async function updatePersona(personaId, payload) {
  if (!(await getPersonaById(personaId))) return null;
  const normalized = normalizePersonaPayload(payload);

  await execSql(`
    UPDATE personas
    SET
      name = COALESCE(${sqlString(normalized.name)}, name),
      handle = COALESCE(${sqlString(normalized.handle)}, handle),
      niche = COALESCE(${sqlString(normalized.niche)}, niche),
      voice_tone = COALESCE(${sqlString(normalized.voiceTone)}, voice_tone),
      voice_controls = COALESCE(${normalized.voiceControls ? sqlJson(normalized.voiceControls) : "NULL"}, voice_controls),
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
          ${sqlString(normalizedQuery.provider || (getDefaultProviders()[0] || "rss"))},
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
  return getPersonaById(personaId);
}

async function addPersonaQuery(personaId, payload) {
  if (!(await getPersonaById(personaId))) return null;
  const query = normalizeQueryPayload(payload, { partial: false });
  const queryId = newId("query");
  await execSql(`
    INSERT INTO persona_queries (
      id, persona_id, query, source_type, provider, weight, is_active,
      user_edited, user_edited_at, locked_from_seed_overwrite, updated_at
    )
    VALUES (
      ${sqlString(queryId)}, ${sqlString(personaId)}, ${sqlString(query.query)},
      ${sqlString(query.sourceType || "public_feed")}, ${sqlString(query.provider || (getDefaultProviders()[0] || "rss"))},
      ${Number(query.weight || 1)}, ${query.isActive === false ? 0 : 1},
      1, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP
    );
  `);
  await audit("persona_query.created", "persona_query", queryId, { personaId, queryId });
  return getPersonaById(personaId);
}

async function deletePersonaQuery(personaId, queryId) {
  const existing = await getPersonaQuery(personaId, queryId);
  if (!existing) return null;
  await execSql(`
    DELETE FROM persona_queries
    WHERE id = ${sqlString(queryId)} AND persona_id = ${sqlString(personaId)};
  `);
  await audit("persona_query.deleted", "persona_query", queryId, { personaId, queryId });
  return getPersonaById(personaId);
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
  const value = String(provider || "").trim().toLowerCase();
  // Fallback handled by callers / config; here we validate against registry if provided
  if (!value) {
    // allow empty here; callers decide default (see PART4 config/defaultProviders)
    return "";
  }
  const fn = getProvider(value);
  if (!fn) {
    const available = listProviders().join(", ") || "(no providers registered)";
    throw validationError(`provider must be one of the registered providers: ${available}`);
  }
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
  if (payload.voiceControls !== undefined) {
    normalized.voiceControls = normalizeVoiceControls(payload.voiceControls, payload.id || "");
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
    provider: query.provider || (getDefaultProviders()[0] || "rss"),
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
          ${sqlString(query.provider || (getDefaultProviders()[0] || "rss"))},
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
  const defaults = getDefaultProviders();
  if (!partial || payload.provider !== undefined) normalized.provider = normalizeProvider(payload.provider || defaults[0] || "");
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
  if (!(await getPersonaById(personaId))) return null;
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
  return getPersonaById(personaId);
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
  return getPersonaById(personaId);
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

function compactVoiceControls(voiceControls = {}) {
  return {
    humor: voiceControls.humorLevel || "medium",
    contrarian: voiceControls.contrarianLevel || "medium",
    explainer: voiceControls.explainerLevel || "medium",
    punchiness: voiceControls.punchinessLevel || "medium",
    memeNative: voiceControls.memeLevel || "low",
    technicalDepth: voiceControls.technicalDepth || "medium",
    emotionalIntensity: voiceControls.emotionalIntensity || "medium",
    riskTolerance: voiceControls.riskTolerance || "medium",
    formality: voiceControls.formalityLevel || "medium"
  };
}

function buildWritingGuidance(persona) {
  const interests = (persona.interests || []).filter((interest) => interest.is_active !== 0 && interest.isActive !== false).map((interest) => interest.label);
  const watchList = (persona.trackedEntities || []).map((item) => item.entity_name || item.name).filter(Boolean);
  const voiceControls = compactVoiceControls(persona.voiceControls);
  const writingDo = [
    voiceControls.explainer === "high" ? "Explain practical consequences clearly." : null,
    voiceControls.punchiness === "high" ? "Use short, punchy sentences." : null,
    voiceControls.humor === "high" ? "Use humor when it sharpens the point." : null,
    voiceControls.technicalDepth === "high" ? "Include credible technical or policy detail." : null,
    interests.length ? `Anchor posts in: ${interests.slice(0, 4).join(", ")}.` : null
  ].filter(Boolean);
  const writingDont = [
    voiceControls.riskTolerance === "low" ? "Avoid unsupported claims and high-risk certainty." : null,
    voiceControls.formality === "low" ? "Avoid stiff institutional phrasing." : null,
    voiceControls.memeNative === "low" ? "Avoid meme-heavy language." : null,
    "Do not collapse into generic social copy."
  ].filter(Boolean);
  return {
    personaName: persona.name,
    handle: persona.handle,
    niche: persona.niche,
    voiceTone: persona.voiceTone,
    interests,
    watchList,
    voiceControls,
    writingDo,
    writingDont
  };
}

export async function exportHermesState() {
  const [personas, recentSignals, settings] = await Promise.all([
    getPersonas({ includeInactiveQueries: true }),
    getSignals({ includeDismissed: true, limit: 50 }),
    getHermesSettings()
  ]);
  // Include new intelligence config
  for (const persona of personas) {
    persona.interests = await getPersonaInterests(persona.id);
    persona.trackedEntities = await getPersonaEntitySubscriptions(persona.id);
    persona.crawlTargets = await getPersonaCrawlTargets(persona.id);
    persona.rssTopics = await getPersonaRssTopics(persona.id);
    persona.watchList = persona.trackedEntities;
    persona.writingGuidance = buildWritingGuidance(persona);
  }
  const trackedEntities = await getTrackedEntities();
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
    hermesSettings: settings,
    trackedEntities
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
  const recentTopicsByPersona = new Map(
    await Promise.all(personas.map(async (persona) => [
      persona.id,
      (await getSignalsForPersona(persona.id)).slice(0, 20).map((signal) => signal.topic)
    ]))
  );

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
    const personaResults = await Promise.allSettled(personas.map(async (persona) => {
      const recentTopics = (await getSignalsForPersona(persona.id)).slice(0, 20).map((signal) => signal.topic);
      const result = await buildSignalsForPersona(persona, recentTopics, {
        forceMock: Boolean(payload.useMockProviders),
        ignoreProviderErrors: true,
        maxSignalsPerPersona: payload.maxSignalsPerPersona || 6
      });
      return { persona, result };
    }));

    for (const settled of personaResults) {
      if (settled.status === "rejected") {
        console.error("[runIngestion] persona failed:", settled.reason?.message || settled.reason);
        continue;
      }

      const { result } = settled.value;
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
            priority_score, source_count, cluster_id, status, suggested_angle, editorial_metadata, evidence_urls
          )
          VALUES (
            ${sqlString(persistedSignal.id)}, ${sqlString(persistedSignal.personaId)}, ${sqlString(persistedSignal.topic)},
            ${sqlString(persistedSignal.source)}, ${sqlString(persistedSignal.query)}, ${sqlString(persistedSignal.firstSeenAt)},
            ${sqlString(persistedSignal.lastSeenAt)}, ${persistedSignal.velocityScore}, ${persistedSignal.relevanceScore},
            ${persistedSignal.noveltyScore}, ${persistedSignal.freshnessScore}, ${persistedSignal.riskScore},
            ${persistedSignal.priorityScore}, ${persistedSignal.sourceCount}, ${sqlString(persistedSignal.clusterId)},
            'new', ${sqlString(persistedSignal.suggestedAngle)}, ${sqlJson(persistedSignal.editorialMetadata || {})}, ${sqlJson(persistedSignal.evidenceUrls)}
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

function cleanTopicForDraft(topic = "") {
  return String(topic || "")
    .replace(/\s*\/\s*(Highlights|Posts|Posts and Replies)\s*\/\s*X\s*-?\s*Twitter\s*$/i, "")
    .replace(/^Watch List entity\s+/i, "")
    .replace(/\s+—\s+new opportunity detected$/i, "")
    .trim();
}

function extractEntityFromSignal(signal = {}) {
  const topic = cleanTopicForDraft(signal.topic || "");
  const query = String(signal.query || "");
  const match = query.match(/Watch List:\s*(.+?)\s*\(/i) || topic.match(/^(.+?)\s+comments|^(.+?)\s+analyzes|^(.+?)\s+shares/i);
  return (match?.[1] || match?.[2] || match?.[3] || topic.split(" — ")[0] || "This signal").trim();
}

function buildDraftBody(persona, signal, variantIndex) {
  const importedDrafts = Array.isArray(signal.editorialMetadata?.importedDrafts)
    ? signal.editorialMetadata.importedDrafts
    : [];
  const imported = importedDrafts[variantIndex % Math.max(importedDrafts.length, 1)];
  const importedBody = String(imported?.content || imported?.body || "").trim();
  if (importedBody) return importedBody.slice(0, 280);

  const topic = cleanTopicForDraft(signal.topic || persona.niche).replace(/[.?!]+$/g, "");
  const entity = extractEntityFromSignal(signal);
  const angle = String(signal.suggestedAngle || "").replace(/^Timely opportunity from monitored entity\s+/i, "").trim();
  const controls = persona.voiceControls || normalizeVoiceControls({}, persona.id);
  const interests = (persona.interests || []).map((interest) => interest.label).filter(Boolean).slice(0, 2);
  const interestClause = interests.length ? ` through ${interests.join(" and ")}` : "";
  const lead = controls.humorLevel === "high"
    ? "The funny part is also the useful part"
    : controls.explainerLevel === "high"
      ? "The practical read"
      : controls.punchinessLevel === "high"
        ? "Watch this"
        : "The useful signal";
  const close = controls.contrarianLevel === "high"
    ? "The consensus read is probably too lazy."
    : controls.technicalDepth === "high"
      ? "The details matter more than the announcement."
      : controls.emotionalIntensity === "high"
        ? "People feel this because it changes who has power."
        : "That is the part worth watching.";
  const variants = [
    `${lead}${interestClause}: ${topic}. ${close}`,
    `The uncomfortable part of ${topic}: incentives can change faster than the institutions around them. ${close}`,
    `Practical read from ${entity}: look for the behavior underneath the announcement. ${close}`
  ];
  if (variantIndex === 2 && angle && angle.length < 120) {
    return `${topic}. The useful question: ${angle.replace(/\.$/, "")}. That is where the conversation gets concrete.`.slice(0, 276);
  }
  return variants[variantIndex % variants.length].slice(0, 276);
}

function buildDraftEditorialMetadata(sourceSignals = [], seed = {}) {
  const metadataSources = sourceSignals.length ? sourceSignals : [seed];
  const primary = metadataSources.find((signal) => signal.editorialMetadata && Object.keys(signal.editorialMetadata).length)
    || metadataSources[0]
    || {};
  const primaryMetadata = primary.editorialMetadata || {};
  const warnings = metadataSources
    .flatMap((signal) => signal.editorialMetadata?.qualityWarnings || [])
    .filter(Boolean)
    .map(String);
  return {
    ...primaryMetadata,
    personaVoiceConfig: sourceSignals[0]?.personaVoiceConfig || seed.personaVoiceConfig || null,
    sourceSignalTopics: metadataSources.map((signal) => signal.topic).filter(Boolean),
    qualityWarnings: [...new Set([...(primaryMetadata.qualityWarnings || []), ...warnings])]
  };
}

function mergeEditorialQuality(qualityChecks, editorialMetadata = {}) {
  const editorialWarnings = Array.isArray(editorialMetadata.qualityWarnings)
    ? editorialMetadata.qualityWarnings.filter(Boolean).map(String)
    : [];
  const qualityScore = Number(editorialMetadata.qualityScore);
  const warnings = [...new Set([...(qualityChecks.warnings || []), ...editorialWarnings])];
  const errors = [...(qualityChecks.errors || [])];
  if (Number.isFinite(qualityScore) && qualityScore < 50) {
    errors.push(`Editorial quality score is ${qualityScore}; draft needs revision before review.`);
  }
  return {
    ...qualityChecks,
    warnings,
    errors,
    editorialQualityScore: Number.isFinite(qualityScore) ? qualityScore : null,
    passed: errors.length === 0
  };
}

export async function generateDrafts(payload) {
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
  if (sourceSignalIds.length) {
    const foundIds = new Set(sourceSignals.map((signal) => signal.id));
    const missingIds = sourceSignalIds.filter((signalId) => !foundIds.has(signalId));
    const foreignSignals = sourceSignals.filter((signal) => signal.personaId !== personaId);
    if (missingIds.length || foreignSignals.length) {
      throw validationError("signalIds must exist and belong to the requested persona");
    }
  }
  const draftSeeds = sourceSignals.length ? sourceSignals : [{ topic: persona.niche, suggestedAngle: persona.voiceTone }];
  const created = [];

  for (let index = 0; index < count; index += 1) {
    const seed = draftSeeds[index % draftSeeds.length];
    const draftId = newId("draft");
    const ids = sourceSignals.map((signal) => signal.id).filter(Boolean);
    const body = buildDraftBody(persona, seed, index);
    const hashtags = [];
    const editorialMetadata = {
      ...buildDraftEditorialMetadata(sourceSignals, seed),
      personaVoiceConfig: {
        voiceTone: persona.voiceTone,
        voiceControls: persona.voiceControls,
        interests: (persona.interests || []).map((interest) => interest.label)
      }
    };
    const qualityChecks = mergeEditorialQuality(evaluateXDraftQuality(body), editorialMetadata);
    const status = qualityChecks.passed ? "needs_review" : "needs_edit";
    await execSql(`
      INSERT INTO drafts (
        id, persona_id, body, original_body, edited_body, platform,
        media_refs, hashtags, status, quality_checks, editorial_metadata, source_signal_ids
      )
      VALUES (
        ${sqlString(draftId)}, ${sqlString(personaId)}, ${sqlString(body)},
        ${sqlString(body)}, ${sqlString(body)}, ${sqlString(payload.platform || "x")},
        ${sqlJson([])}, ${sqlJson(hashtags)}, ${sqlString(status)}, ${sqlJson(qualityChecks)},
        ${sqlJson(editorialMetadata)}, ${sqlJson(ids)}
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
      status,
      qualityChecks,
      editorialMetadata,
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
  if (payload.status !== undefined && payload.status !== existing.status) {
    throw validationError("Use the explicit draft approve, reject, regenerate, schedule, or publish workflow endpoint for status changes.");
  }
  const nextBody = payload.editedBody ?? payload.body ?? existing.body;
  const qualityChecks = mergeEditorialQuality(evaluateXDraftQuality(nextBody), existing.editorialMetadata || {});
  const nextStatus = qualityChecks.passed
    ? (existing.status === "needs_edit" ? "needs_review" : existing.status)
    : "needs_edit";
  await execSql(`
    UPDATE drafts
    SET
      edited_body = COALESCE(${sqlString(payload.editedBody ?? payload.body)}, edited_body),
      body = COALESCE(${sqlString(payload.editedBody ?? payload.body)}, body),
      platform = COALESCE(${sqlString(payload.platform)}, platform),
      status = ${sqlString(nextStatus)},
      review_reason = COALESCE(${sqlString(payload.reviewReason)}, review_reason),
      rejection_reason = COALESCE(${sqlString(payload.rejectionReason)}, rejection_reason),
      quality_checks = ${sqlJson(qualityChecks)},
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${sqlString(draftId)};
  `);
  await audit("draft.edited", "draft", draftId, { fields: Object.keys(payload) });
  return getDraft(draftId);
}

export async function setDraftStatus(draftId, status, payload = {}) {
  const existing = await getDraft(draftId);
  if (!existing) return null;
  if (!["needs_review", "approved", "rejected"].includes(existing.status)) {
    throw validationError(`Cannot ${status} draft from status ${existing.status}`);
  }
  if (status === "approved" && existing.status !== "needs_review") {
    throw validationError("Only drafts needing review can be approved.");
  }
  if (status === "rejected" && existing.status !== "needs_review") {
    throw validationError("Only drafts needing review can be rejected.");
  }
  const qualityChecks = evaluateXDraftQuality(existing.body);
  if (status === "approved" && !qualityChecks.passed) {
    throw validationError(`Draft failed X quality checks: ${qualityChecks.errors.join(" ")}`);
  }
  const reviewReason = payload.reviewReason ?? payload.reason ?? null;
  const rejectionReason = payload.rejectionReason ?? payload.reason ?? null;
  await execSql(`
    UPDATE drafts
    SET status = ${sqlString(status)},
        review_reason = COALESCE(${sqlString(status === "approved" ? reviewReason : null)}, review_reason),
        rejection_reason = COALESCE(${sqlString(status === "rejected" ? rejectionReason : null)}, rejection_reason),
        quality_checks = ${sqlJson(qualityChecks)},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${sqlString(draftId)};
  `);
  if (status === "approved") {
    await markSignalsUsed(existing.sourceSignalIds);
    await audit("draft.approved", "draft", draftId, { sourceSignalIds: existing.sourceSignalIds, reason: reviewReason });
  }
  if (status === "rejected") {
    await audit("draft.rejected", "draft", draftId, { sourceSignalIds: existing.sourceSignalIds, reason: rejectionReason });
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
    SET edited_body = ${sqlString(body)},
        body = ${sqlString(body)},
        status = 'needs_review',
        quality_checks = ${sqlJson(mergeEditorialQuality(evaluateXDraftQuality(body), existing.editorialMetadata || {}))},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${sqlString(draftId)};
  `);
  await audit("draft.regenerated", "draft", draftId);
  return getDraft(draftId);
}

export async function createScheduledPost(payload) {
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
    if (payload.personaId && payload.personaId !== draft.personaId) {
      throw validationError("Scheduled post persona must match the draft persona.");
    }
    if (draft.status !== "approved") {
      throw validationError("Only approved drafts can be scheduled.");
    }
    if (!evaluateXDraftQuality(draft.body).passed) {
      throw validationError("Draft must pass X quality checks before scheduling.");
    }
  }

  const body = payload.body || draft?.body || "Raw scheduled content";
  const qualityChecks = evaluateXDraftQuality(body);
  if (!qualityChecks.passed) {
    throw validationError(`Scheduled post failed X quality checks: ${qualityChecks.errors.join(" ")}`);
  }

  const post = {
    id: newId("post"),
    draftId,
    personaId: payload.personaId || draft?.personaId || null,
    platform: payload.platform || "x",
    body,
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

async function updateScheduledPost(postId, payload, options = {}) {
  const existing = await querySql(`SELECT * FROM scheduled_posts WHERE id = ${sqlString(postId)} LIMIT 1;`);
  if (!existing.length) return null;
  const current = mapScheduledPost(existing[0]);
  if (payload.status !== undefined && payload.status !== current.status && !options.allowStatusChange) {
    throw validationError("Use the explicit schedule cancel or mark-published workflow endpoint for status changes.");
  }
  if (options.targetStatus === "cancelled" && current.status !== "scheduled") {
    throw validationError(`Cannot cancel scheduled post from status ${current.status}.`);
  }
  const nextBody = payload.body ?? current.body;
  const qualityChecks = evaluateXDraftQuality(nextBody);
  if (!qualityChecks.passed) {
    throw validationError(`Scheduled post failed X quality checks: ${qualityChecks.errors.join(" ")}`);
  }
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
  const updated = await updateScheduledPost(postId, { status: "cancelled" }, { allowStatusChange: true, targetStatus: "cancelled" });
  if (updated) await audit("scheduled_post.cancelled", "scheduled_post", postId);
  return updated;
}

async function getScheduledPost(postId) {
  const rows = await querySql(`SELECT * FROM scheduled_posts WHERE id = ${sqlString(postId)} LIMIT 1;`);
  return rows.length ? mapScheduledPost(rows[0]) : null;
}

function normalizeMetric(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) {
    throw validationError("Performance metrics must be non-negative numbers.");
  }
  return Math.round(number);
}

export async function getPublishedPosts(filters = {}) {
  const clauses = ["1 = 1"];
  if (filters.personaId) clauses.push(`persona_id = ${sqlString(filters.personaId)}`);
  if (filters.scheduledPostId) clauses.push(`scheduled_post_id = ${sqlString(filters.scheduledPostId)}`);
  const rows = await querySql(`
    SELECT *
    FROM published_posts
    WHERE ${clauses.join(" AND ")}
    ORDER BY published_at DESC, created_at DESC
    LIMIT ${Math.max(1, Math.min(200, Number(filters.limit || 100)))};
  `);
  return rows.map(mapPublishedPost);
}

async function getPublishedPost(postId) {
  const rows = await querySql(`SELECT * FROM published_posts WHERE id = ${sqlString(postId)} LIMIT 1;`);
  return rows.length ? mapPublishedPost(rows[0]) : null;
}

async function createPublishedPost(payload = {}) {
  const scheduledPostId = payload.scheduledPostId || payload.scheduled_post_id || null;
  let scheduledPost = null;
  if (scheduledPostId) {
    scheduledPost = await getScheduledPost(scheduledPostId);
    if (!scheduledPost) {
      const error = new Error("Scheduled post not found");
      error.status = 404;
      throw error;
    }
    const existingPublished = (await getPublishedPosts({ scheduledPostId, limit: 1 }))[0];
    if (existingPublished) return existingPublished;
    if (scheduledPost.status !== "scheduled") {
      throw validationError(`Only scheduled posts can be marked published. Current status: ${scheduledPost.status}.`);
    }
  }

  const publishedAt = payload.publishedAt || new Date().toISOString();
  const post = {
    id: newId("pub"),
    scheduledPostId,
    draftId: payload.draftId || scheduledPost?.draftId || null,
    personaId: payload.personaId || scheduledPost?.personaId || null,
    platform: payload.platform || scheduledPost?.platform || "x",
    externalPostId: payload.externalPostId || null,
    publishedUrl: payload.publishedUrl || null,
    body: payload.body || scheduledPost?.body || "",
    mediaRefs: payload.mediaRefs || scheduledPost?.mediaRefs || [],
    hashtags: payload.hashtags || scheduledPost?.hashtags || [],
    status: payload.status || "published_manual",
    publishedAt,
    sourceSignalIds: payload.sourceSignalIds || scheduledPost?.sourceSignalIds || [],
    impressions: normalizeMetric(payload.impressions),
    likes: normalizeMetric(payload.likes),
    reposts: normalizeMetric(payload.reposts),
    replies: normalizeMetric(payload.replies),
    bookmarks: normalizeMetric(payload.bookmarks),
    engagementNotes: payload.engagementNotes || payload.notes || null
  };

  if (!post.body.trim()) {
    const error = new Error("body is required");
    error.status = 400;
    throw error;
  }
  const qualityChecks = evaluateXDraftQuality(post.body);
  if (!qualityChecks.passed) {
    throw validationError(`Published post failed X quality checks: ${qualityChecks.errors.join(" ")}`);
  }

  await execSql(`
    INSERT INTO published_posts (
      id, scheduled_post_id, draft_id, persona_id, platform, external_post_id,
      published_url, body, media_refs, hashtags, status, published_at,
      source_signal_ids, impressions, likes, reposts, replies, bookmarks,
      engagement_notes, performance_updated_at
    )
    VALUES (
      ${sqlString(post.id)}, ${sqlString(post.scheduledPostId)}, ${sqlString(post.draftId)},
      ${sqlString(post.personaId)}, ${sqlString(post.platform)}, ${sqlString(post.externalPostId)},
      ${sqlString(post.publishedUrl)}, ${sqlString(post.body)}, ${sqlJson(post.mediaRefs)},
      ${sqlJson(post.hashtags)}, ${sqlString(post.status)}, ${sqlString(post.publishedAt)},
      ${sqlJson(post.sourceSignalIds)}, ${post.impressions}, ${post.likes}, ${post.reposts},
      ${post.replies}, ${post.bookmarks}, ${sqlString(post.engagementNotes)},
      ${sqlString(post.engagementNotes || post.impressions || post.likes || post.reposts || post.replies || post.bookmarks ? new Date().toISOString() : null)}
    );
  `);

  if (scheduledPostId) {
    await execSql(`
      UPDATE scheduled_posts
      SET status = 'published', updated_at = CURRENT_TIMESTAMP
      WHERE id = ${sqlString(scheduledPostId)};
    `);
  }
  if (post.draftId) {
    await execSql(`UPDATE drafts SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = ${sqlString(post.draftId)};`);
  }
  await markSignalsUsed(post.sourceSignalIds);
  await audit("published_post.created", "published_post", post.id, {
    scheduledPostId,
    manual: true,
    externalPublishAttempted: false
  });
  return getPublishedPost(post.id);
}

export async function markScheduledPostPublished(postId, payload = {}) {
  return createPublishedPost({ ...payload, scheduledPostId: postId });
}

async function updatePublishedPostPerformance(postId, payload = {}) {
  const existing = await getPublishedPost(postId);
  if (!existing) return null;
  const next = {
    impressions: payload.impressions === undefined ? existing.performance.impressions : normalizeMetric(payload.impressions),
    likes: payload.likes === undefined ? existing.performance.likes : normalizeMetric(payload.likes),
    reposts: payload.reposts === undefined ? existing.performance.reposts : normalizeMetric(payload.reposts),
    replies: payload.replies === undefined ? existing.performance.replies : normalizeMetric(payload.replies),
    bookmarks: payload.bookmarks === undefined ? existing.performance.bookmarks : normalizeMetric(payload.bookmarks),
    notes: payload.engagementNotes ?? payload.notes ?? existing.performance.notes
  };
  await execSql(`
    UPDATE published_posts
    SET impressions = ${next.impressions},
        likes = ${next.likes},
        reposts = ${next.reposts},
        replies = ${next.replies},
        bookmarks = ${next.bookmarks},
        engagement_notes = ${sqlString(next.notes)},
        performance_updated_at = ${sqlString(new Date().toISOString())},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${sqlString(postId)};
  `);
  await audit("published_post.performance_updated", "published_post", postId, next);
  return getPublishedPost(postId);
}

async function getOperatorDraftChoices(filters = {}) {
  const clauses = ["1 = 1"];
  if (filters.personaId) clauses.push(`persona_id = ${sqlString(filters.personaId)}`);
  if (filters.signalId) clauses.push(`signal_id = ${sqlString(filters.signalId)}`);
  if (filters.outcome) clauses.push(`outcome = ${sqlString(filters.outcome)}`);
  const limit = Math.max(1, Math.min(200, Number(filters.limit || 100)));
  const rows = await querySql(`
    SELECT *
    FROM operator_draft_choices
    WHERE ${clauses.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT ${limit};
  `);
  return rows.map(mapOperatorDraftChoice);
}

async function getOperatorDraftChoice(choiceId) {
  const rows = await querySql(`SELECT * FROM operator_draft_choices WHERE id = ${sqlString(choiceId)} LIMIT 1;`);
  return rows.length ? mapOperatorDraftChoice(rows[0]) : null;
}

function normalizeSelectedVariant(value) {
  const variant = String(value || "A").toLowerCase();
  if (variant === "a") return "A";
  if (variant === "b") return "B";
  if (variant === "neither") return "neither";
  throw validationError("selectedVariant must be A, B, or neither.");
}

function normalizeChoiceOutcome(value) {
  const outcome = String(value || "recorded");
  if (["recorded", "scheduled", "published", "skipped"].includes(outcome)) return outcome;
  throw validationError("outcome must be recorded, scheduled, published, or skipped.");
}

function finalTextForOperatorChoice(payload = {}, existingChoice = null) {
  const selectedVariant = normalizeSelectedVariant(payload.selectedVariant || existingChoice?.selectedVariant || "A");
  const explicitText = String(payload.editedFinalText || "").trim();
  if (explicitText) return explicitText;
  if (existingChoice?.editedFinalText) return existingChoice.editedFinalText;
  if (selectedVariant === "B" && payload.draftB) return String(payload.draftB).trim();
  if (selectedVariant === "neither") return String(payload.draftA || existingChoice?.draftA || "Operator skipped this draft.").trim();
  return String(payload.draftA || existingChoice?.draftA || "").trim();
}

export async function createOperatorDraftChoice(payload = {}) {
  const personaId = payload.personaId;
  if (!personaId) throw validationError("personaId is required.");
  if (!(await getPersonaById(personaId))) {
    const error = new Error("Persona not found");
    error.status = 404;
    throw error;
  }

  const providedSourceSignalIds = Array.isArray(payload.sourceSignalIds)
    ? [...new Set(payload.sourceSignalIds.filter(Boolean))]
    : payload.signalId
      ? [payload.signalId]
      : [];
  const sourceSignalIds = [...new Set([payload.signalId, ...providedSourceSignalIds].filter(Boolean))];
  const signalId = payload.signalId || sourceSignalIds[0] || null;
  if (sourceSignalIds.length) {
    const rows = await querySql(`SELECT * FROM signals WHERE id IN (${sourceSignalIds.map(sqlString).join(",")});`);
    const found = rows.map(mapSignal);
    const foundIds = new Set(found.map((signal) => signal.id));
    const missingIds = sourceSignalIds.filter((id) => !foundIds.has(id));
    const foreignSignals = found.filter((signal) => signal.personaId !== personaId);
    if (missingIds.length || foreignSignals.length) {
      throw validationError("sourceSignalIds must exist and belong to personaId.");
    }
  }

  const draftA = String(payload.draftA || "").trim();
  const draftB = payload.draftB === undefined || payload.draftB === null ? null : String(payload.draftB).trim();
  const outcome = normalizeChoiceOutcome(payload.outcome);
  const isSkipOutcome = outcome === "skipped";
  if (!draftA) throw validationError("draftA is required.");
  const selectedVariant = normalizeSelectedVariant(payload.selectedVariant);
  const editedFinalText = isSkipOutcome ? "skipped" : finalTextForOperatorChoice({ ...payload, draftA, draftB, selectedVariant });
  if (!isSkipOutcome && !editedFinalText) throw validationError("editedFinalText or draft text is required.");
  if (selectedVariant === "B" && !draftB) throw validationError("draftB is required when selectedVariant is B.");
  if (!isSkipOutcome) {
    const qualityChecks = evaluateXDraftQuality(editedFinalText);
    if (!qualityChecks.passed) {
      throw validationError(`Choice final text failed X quality checks: ${qualityChecks.errors.join(" ")}`);
    }
  }

  const id = newId("choice");
  await execSql(`
    INSERT INTO operator_draft_choices (
      id, persona_id, signal_id, source_signal_ids, draft_a, draft_b,
      selected_variant, edited_final_text, choice_reason, outcome,
      scheduled_post_id, published_post_id
    )
    VALUES (
      ${sqlString(id)}, ${sqlString(personaId)}, ${sqlString(signalId)}, ${sqlJson(sourceSignalIds)},
      ${sqlString(draftA)}, ${sqlString(draftB)}, ${sqlString(selectedVariant)},
      ${sqlString(editedFinalText)}, ${sqlString(payload.choiceReason || null)}, ${sqlString(outcome)},
      ${sqlString(payload.scheduledPostId || null)}, ${sqlString(payload.publishedPostId || null)}
    );
  `);
  await audit("operator_draft_choice.created", "operator_draft_choice", id, {
    personaId,
    signalId,
    selectedVariant,
    outcome,
    noExternalPublishing: true
  });
  return getOperatorDraftChoice(id);
}

export async function updateOperatorDraftChoiceOutcome(choiceId, payload = {}) {
  const existing = await getOperatorDraftChoice(choiceId);
  if (!existing) return null;
  const outcome = normalizeChoiceOutcome(payload.outcome || existing.outcome);
  const editedFinalText = outcome === "skipped"
    ? (existing.editedFinalText || "skipped")
    : finalTextForOperatorChoice(payload, existing);
  if (!editedFinalText) throw validationError("editedFinalText or draft text is required.");
  if (outcome !== "skipped") {
    const qualityChecks = evaluateXDraftQuality(editedFinalText);
    if (!qualityChecks.passed) {
      throw validationError(`Choice final text failed X quality checks: ${qualityChecks.errors.join(" ")}`);
    }
  }
  await execSql(`
    UPDATE operator_draft_choices
    SET selected_variant = COALESCE(${sqlString(payload.selectedVariant ? normalizeSelectedVariant(payload.selectedVariant) : null)}, selected_variant),
        edited_final_text = ${sqlString(editedFinalText)},
        choice_reason = COALESCE(${sqlString(payload.choiceReason)}, choice_reason),
        outcome = ${sqlString(outcome)},
        scheduled_post_id = COALESCE(${sqlString(payload.scheduledPostId)}, scheduled_post_id),
        published_post_id = COALESCE(${sqlString(payload.publishedPostId)}, published_post_id),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${sqlString(choiceId)};
  `);
  await audit("operator_draft_choice.outcome_updated", "operator_draft_choice", choiceId, {
    outcome,
    scheduledPostId: payload.scheduledPostId || existing.scheduledPostId || null,
    publishedPostId: payload.publishedPostId || existing.publishedPostId || null
  });
  return getOperatorDraftChoice(choiceId);
}

function countByPersona(items, personaId) {
  return items.filter((item) => item.personaId === personaId).length;
}

async function createNotification({ personaId, signalId, topic, draftCount = 1, priorityScore = 0, runType = "" }) {
  const existing = await querySql(`
    SELECT id FROM notifications
    WHERE persona_id = ${sqlString(personaId)}
      AND signal_id = ${sqlString(signalId || "")}
      AND read_at IS NULL
    LIMIT 1;
  `);
  if (existing.length) return existing[0];
  const id = newId("notif");
  const now = new Date().toISOString();
  await execSql(`
    INSERT INTO notifications (id, persona_id, entity_name, topic, signal_id, draft_count, priority_score, confidence, run_type, is_test, created_at)
    VALUES (${sqlString(id)}, ${sqlString(personaId)}, ${sqlString("")}, ${sqlString(topic)},
      ${sqlString(signalId || "")}, ${draftCount}, ${priorityScore}, 0.85,
      ${sqlString(runType)}, 0, ${sqlString(now)});
  `);
  return { id };
}

async function getUnreadNotificationCount() {
  const rows = await querySql("SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL;");
  return Number(rows[0]?.count || 0);
}

async function getNotifications(filters = {}) {
  const clauses = ["1 = 1"];
  if (filters.unreadOnly) clauses.push("read_at IS NULL");
  const limit = Math.max(1, Math.min(50, Number(filters.limit || 20)));
  const rows = await querySql(`
    SELECT n.*, p.name AS persona_name
    FROM notifications n
    LEFT JOIN personas p ON p.id = n.persona_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY n.created_at DESC
    LIMIT ${limit};
  `);
  return rows.map((r) => ({
    id: r.id,
    personaId: r.persona_id,
    personaName: r.persona_name || "",
    entityName: r.entity_name || "",
    topic: r.topic,
    signalId: r.signal_id,
    draftCount: r.draft_count,
    priorityScore: r.priority_score,
    confidence: r.confidence,
    runType: r.run_type,
    isTest: Boolean(r.is_test),
    readAt: r.read_at,
    createdAt: r.created_at
  }));
}

async function markNotificationRead(notificationId) {
  await execSql(`UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ${sqlString(notificationId)};`);
}

export async function getOperatorQueue() {
  const [personas, signals, alerts, drafts, scheduledRows, published, choices] = await Promise.all([
    getPersonas({ includeInactiveQueries: true }),
    getSignals({ includeDismissed: false, limit: 200, excludeTestMode: true }),
    getVelocityAlerts({}),
    querySql("SELECT * FROM drafts ORDER BY updated_at DESC, created_at DESC LIMIT 100;"),
    querySql("SELECT * FROM scheduled_posts ORDER BY scheduled_at ASC LIMIT 100;"),
    getPublishedPosts({ limit: 100 }),
    getOperatorDraftChoices({ limit: 100 })
  ]);
  const linkedSignalIds = [...new Set(drafts.flatMap((row) => parseJsonField(row.source_signal_ids, [])))].filter(Boolean);
  const linkedNoiseRows = linkedSignalIds.length
    ? await querySql(`
      SELECT id
      FROM signals
      WHERE id IN (${linkedSignalIds.map(sqlString).join(",")})
        AND NOT (${productionSignalSqlFilter()});
    `)
    : [];
  const noisyLinkedSignalIds = new Set(linkedNoiseRows.map((row) => row.id));
  const allDrafts = drafts
    .map(mapDraft)
    .filter((draft) => {
      const sourceIds = draft.sourceSignalIds || [];
      const text = lowerText([draft.body, draft.originalBody, draft.editedBody, sourceIds.join(" ")].join(" "));
      if (OPERATOR_NOISE_PATTERNS.some((pattern) => text.includes(pattern))) return false;
      if (draft.qualityChecks?.passed === false) return false;
      if (sourceIds.some((id) => noisyLinkedSignalIds.has(id))) return false;
      return true;
    });
  const scheduled = scheduledRows.map(mapScheduledPost);
  const queue = personas.map((persona) => {
    const personaSignals = signals.filter((signal) => signal.personaId === persona.id && !["used", "dismissed", "archived"].includes(signal.status)).slice(0, 8);
    const personaAlerts = alerts.filter((alert) => alert.personaId === persona.id).slice(0, 5);
    const personaDrafts = allDrafts.filter((draft) => draft.personaId === persona.id).slice(0, 8);
    const personaScheduled = scheduled.filter((post) => post.personaId === persona.id).slice(0, 8);
    const personaPublished = published.filter((post) => post.personaId === persona.id).slice(0, 8);
    const personaChoices = choices.filter((choice) => choice.personaId === persona.id).slice(0, 8);
    const needsDraft = personaSignals.length > 0 && !personaDrafts.some((draft) => ["needs_review", "approved", "scheduled"].includes(draft.status));
    const needsSchedule = personaDrafts.some((draft) => draft.status === "approved") && !personaScheduled.some((post) => post.status === "scheduled");
    const needsPerformance = personaPublished.some((post) => !post.performance.updatedAt);
    return {
      persona,
      summary: {
        openSignalCount: personaSignals.length,
        velocityAlertCount: personaAlerts.length,
        draftCount: countByPersona(allDrafts, persona.id),
        scheduledCount: countByPersona(scheduled, persona.id),
        publishedCount: countByPersona(published, persona.id),
        needsDraft,
        needsSchedule,
        needsPerformance
      },
      recommendedActions: [
        needsDraft ? "Generate or edit an X draft from top signals." : null,
        personaAlerts.length ? "Review velocity alerts for timing-sensitive posts." : null,
        needsSchedule ? "Schedule approved drafts manually." : null,
        needsPerformance ? "Enter manual performance for published posts." : null
      ].filter(Boolean),
      signals: personaSignals,
      velocityAlerts: personaAlerts,
      drafts: personaDrafts,
      scheduledPosts: personaScheduled,
      publishedPosts: personaPublished,
      draftChoices: personaChoices
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    noExternalPublishing: true,
    xCredentialsRequired: false,
    personas: queue
  };
}

function decodePathPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "persona-command-center",
      phase: 4,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      activeConnections: activeRequests.size,
      dbPath,
      walConfigured: true,
      busyTimeout: 5000
    });
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
    const persona = await getPersonaById(decodePathPart(personaGetMatch[1]));
    if (!persona) sendJson(res, 404, { error: "Persona not found" });
    else sendJson(res, 200, persona);
    return;
  }

  const personaUpdateMatch = url.pathname.match(/^\/api\/personas\/([^/]+)$/);
  if ((req.method === "POST" || req.method === "PATCH") && personaUpdateMatch) {
    const updated = await updatePersona(decodePathPart(personaUpdateMatch[1]), await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Persona not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const personaQueryMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/queries$/);
  if (req.method === "POST" && personaQueryMatch) {
    const updated = await addPersonaQuery(decodePathPart(personaQueryMatch[1]), await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Persona not found" });
    else sendJson(res, 201, updated);
    return;
  }

  const personaQueryPatchMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/queries\/([^/]+)$/);
  if (req.method === "PATCH" && personaQueryPatchMatch) {
    const updated = await updatePersonaQuery(decodePathPart(personaQueryPatchMatch[1]), decodePathPart(personaQueryPatchMatch[2]), await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Persona query not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const personaQueryToggleMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/queries\/([^/]+)\/toggle$/);
  if (req.method === "PATCH" && personaQueryToggleMatch) {
    const updated = await togglePersonaQuery(decodePathPart(personaQueryToggleMatch[1]), decodePathPart(personaQueryToggleMatch[2]));
    if (!updated) sendJson(res, 404, { error: "Persona query not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const personaQueryDeleteMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/queries\/([^/]+)$/);
  if (req.method === "DELETE" && personaQueryDeleteMatch) {
    const updated = await deletePersonaQuery(decodePathPart(personaQueryDeleteMatch[1]), decodePathPart(personaQueryDeleteMatch[2]));
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

  if (req.method === "GET" && url.pathname === "/api/notifications") {
    sendJson(res, 200, await getNotifications({
      unreadOnly: url.searchParams.get("unreadOnly") === "true",
      limit: Number(url.searchParams.get("limit") || 20)
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/notifications/unread-count") {
    sendJson(res, 200, { count: await getUnreadNotificationCount() });
    return;
  }

  const notificationReadMatch = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (req.method === "POST" && notificationReadMatch) {
    await markNotificationRead(notificationReadMatch[1]);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/operator/queue") {
    sendJson(res, 200, await getOperatorQueue());
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
    const payload = await readJson(req);
    const updated = await updateSignal(signalDismissMatch[1], { ...payload, status: "dismissed" }, { allowLifecycleStatus: true });
    if (!updated) sendJson(res, 404, { error: "Signal not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const signalReviewedMatch = url.pathname.match(/^\/api\/signals\/([^/]+)\/mark-reviewed$/);
  if (req.method === "POST" && signalReviewedMatch) {
    const payload = await readJson(req);
    const updated = await updateSignal(signalReviewedMatch[1], { ...payload, status: "reviewed" }, { allowLifecycleStatus: true });
    if (!updated) sendJson(res, 404, { error: "Signal not found" });
    else sendJson(res, 200, updated);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ingestion/run") {
    sendJson(res, 201, await runIngestion(await readJson(req)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/hermes/import") {
    const body = await readJson(req);
    const result = await importHermesPayload(body);
    const isTestMode = body.testMode === true || body.runType === "validation_ping" || body.runType === "trial_push";
    result.draftsGenerated = 0;
    result.draftGenerationErrors = [];
    if (!isTestMode && result.importedSignalIds.length > 0) {
      const generatedDrafts = [];
      const personaSignalMap = new Map();
      for (const persona of (body.personas || [])) {
        if (persona.personaId) personaSignalMap.set(persona.personaId, []);
      }
      for (const signalId of result.importedSignalIds) {
        const rows = await querySql(`SELECT * FROM signals WHERE id = ${sqlString(signalId)};`);
        if (rows.length) {
          const signal = mapSignal(rows[0]);
          if (personaSignalMap.has(signal.personaId)) personaSignalMap.get(signal.personaId).push(signal);
        }
      }
      for (const [personaId, signals] of personaSignalMap) {
        if (!signals.length) continue;
        signals.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
        const topSignalIds = signals.slice(0, 2).map((s) => s.id);
        try {
          const drafts = await generateDrafts({ personaId, signalIds: topSignalIds, count: 3 });
          generatedDrafts.push(...drafts);
          await createNotification({
            personaId,
            signalId: topSignalIds[0],
            topic: signals[0].topic || signals[0].suggestedAngle || "Opportunity",
            draftCount: drafts.length,
            priorityScore: signals[0].priorityScore || 0,
            runType: body.runType
          });
        } catch (error) {
          result.draftGenerationErrors.push({
            personaId,
            signalIds: topSignalIds,
            error: error.message
          });
          await audit("draft.generation_failed", "persona", personaId, {
            signalIds: topSignalIds,
            error: error.message,
            runId: result.runId
          });
        }
      }
      result.draftsGenerated = generatedDrafts.length;
    }
    sendJson(res, 201, result);
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
    const rows = await querySql("SELECT * FROM drafts ORDER BY updated_at DESC, created_at DESC LIMIT 200;");
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
    const updated = await setDraftStatus(draftApproveMatch[1], "approved", await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Draft not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const draftRejectMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/reject$/);
  if (req.method === "POST" && draftRejectMatch) {
    const updated = await setDraftStatus(draftRejectMatch[1], "rejected", await readJson(req));
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

  const schedulePublishedMatch = url.pathname.match(/^\/api\/schedule\/([^/]+)\/mark-published$/);
  if (req.method === "POST" && schedulePublishedMatch) {
    const published = await markScheduledPostPublished(schedulePublishedMatch[1], await readJson(req));
    sendJson(res, 201, published);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/published-posts") {
    sendJson(res, 200, await getPublishedPosts({
      personaId: url.searchParams.get("personaId"),
      scheduledPostId: url.searchParams.get("scheduledPostId"),
      limit: url.searchParams.get("limit")
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/published-posts") {
    sendJson(res, 201, await createPublishedPost(await readJson(req)));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/operator/draft-choices") {
    sendJson(res, 200, await getOperatorDraftChoices({
      personaId: url.searchParams.get("personaId"),
      signalId: url.searchParams.get("signalId"),
      outcome: url.searchParams.get("outcome"),
      limit: url.searchParams.get("limit")
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/operator/draft-choices") {
    sendJson(res, 201, await createOperatorDraftChoice(await readJson(req)));
    return;
  }

  const operatorChoiceOutcomeMatch = url.pathname.match(/^\/api\/operator\/draft-choices\/([^/]+)\/outcome$/);
  if (req.method === "PATCH" && operatorChoiceOutcomeMatch) {
    const updated = await updateOperatorDraftChoiceOutcome(operatorChoiceOutcomeMatch[1], await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Operator draft choice not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const publishedPerformanceMatch = url.pathname.match(/^\/api\/published-posts\/([^/]+)\/performance$/);
  if (req.method === "PATCH" && publishedPerformanceMatch) {
    const updated = await updatePublishedPostPerformance(publishedPerformanceMatch[1], await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Published post not found" });
    else sendJson(res, 200, updated);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/audit-log") {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 50)));
    const rows = await querySql(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ${limit};`);
    sendJson(res, 200, rows.map(mapAudit));
    return;
  }

  // ---- Tracked Entities ----
  if (req.method === "GET" && url.pathname === "/api/entities") {
    sendJson(res, 200, await getTrackedEntities());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/entities") {
    sendJson(res, 201, await createTrackedEntity(await readJson(req)));
    return;
  }

  const entityPatchMatch = url.pathname.match(/^\/api\/entities\/([^/]+)$/);
  if (req.method === "PATCH" && entityPatchMatch) {
    const updated = await updateTrackedEntity(decodePathPart(entityPatchMatch[1]), await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Entity not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const entityDeleteMatch = url.pathname.match(/^\/api\/entities\/([^/]+)$/);
  if (req.method === "DELETE" && entityDeleteMatch) {
    sendJson(res, 200, await deleteTrackedEntity(decodePathPart(entityDeleteMatch[1])));
    return;
  }

  // ---- Persona Interests ----
  const personaInterestCreateMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/interests$/);
  if (req.method === "POST" && personaInterestCreateMatch) {
    sendJson(res, 201, await createPersonaInterest(decodePathPart(personaInterestCreateMatch[1]), await readJson(req)));
    return;
  }

  const personaInterestPatchMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/interests\/([^/]+)$/);
  if (req.method === "PATCH" && personaInterestPatchMatch) {
    const updated = await updatePersonaInterest(decodePathPart(personaInterestPatchMatch[2]), await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Interest not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const personaInterestDeleteMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/interests\/([^/]+)$/);
  if (req.method === "DELETE" && personaInterestDeleteMatch) {
    sendJson(res, 200, await deletePersonaInterest(decodePathPart(personaInterestDeleteMatch[2])));
    return;
  }

  // ---- Persona Entity Subscriptions ----
  const personaEntityCreateMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/entities$/);
  if (req.method === "POST" && personaEntityCreateMatch) {
    sendJson(res, 201, await createPersonaEntitySubscription(decodePathPart(personaEntityCreateMatch[1]), await readJson(req)));
    return;
  }

  const personaEntityPatchMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/entities\/([^/]+)$/);
  if (req.method === "PATCH" && personaEntityPatchMatch) {
    const updated = await updatePersonaEntitySubscription(decodePathPart(personaEntityPatchMatch[2]), await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Entity subscription not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const personaEntityDeleteMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/entities\/([^/]+)$/);
  if (req.method === "DELETE" && personaEntityDeleteMatch) {
    sendJson(res, 200, await deletePersonaEntitySubscription(decodePathPart(personaEntityDeleteMatch[2])));
    return;
  }

  // ---- Persona Crawl Targets ----
  const crawlTargetCreateMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/crawl-targets$/);
  if (req.method === "POST" && crawlTargetCreateMatch) {
    sendJson(res, 201, await createPersonaCrawlTarget(decodePathPart(crawlTargetCreateMatch[1]), await readJson(req)));
    return;
  }

  const crawlTargetPatchMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/crawl-targets\/([^/]+)$/);
  if (req.method === "PATCH" && crawlTargetPatchMatch) {
    const updated = await updatePersonaCrawlTarget(decodePathPart(crawlTargetPatchMatch[2]), await readJson(req));
    if (!updated) sendJson(res, 404, { error: "Crawl target not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const crawlTargetDeleteMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/crawl-targets\/([^/]+)$/);
  if (req.method === "DELETE" && crawlTargetDeleteMatch) {
    sendJson(res, 200, await deletePersonaCrawlTarget(decodePathPart(crawlTargetDeleteMatch[2])));
    return;
  }

  // ---- Persona RSS Topics ----
  const rssTopicCreateMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/rss-topics$/);
  if (req.method === "POST" && rssTopicCreateMatch) {
    sendJson(res, 201, await createPersonaRssTopic(decodePathPart(rssTopicCreateMatch[1]), await readJson(req)));
    return;
  }

  const rssTopicPatchMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/rss-topics\/([^/]+)$/);
  if (req.method === "PATCH" && rssTopicPatchMatch) {
    const updated = await updatePersonaRssTopic(decodePathPart(rssTopicPatchMatch[2]), await readJson(req));
    if (!updated) sendJson(res, 404, { error: "RSS topic not found" });
    else sendJson(res, 200, updated);
    return;
  }

  const rssTopicDeleteMatch = url.pathname.match(/^\/api\/personas\/([^/]+)\/rss-topics\/([^/]+)$/);
  if (req.method === "DELETE" && rssTopicDeleteMatch) {
    sendJson(res, 200, await deletePersonaRssTopic(decodePathPart(rssTopicDeleteMatch[2])));
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
    activeRequests.add(req);
    const cleanup = () => activeRequests.delete(req);
    res.on("finish", cleanup);
    res.on("error", cleanup);
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

let server;

function shutdown(signal) {
  if (!server) process.exit(0);
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  server.close(() => process.exit(0));
  setTimeout(() => {
    console.error(`${signal} forced shutdown after timeout.`);
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server = await createAppServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Persona Command Center running at http://127.0.0.1:${port}`);
  });
}
