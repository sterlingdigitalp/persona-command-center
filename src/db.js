import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
export const dbPath = process.env.DB_PATH || path.join(rootDir, "data", "persona-command-center.sqlite");
const seedPersonaIds = ["the-wonkette", "policy-pete", "maga-memester", "progressive-pat"];
let dataDirReady;

async function ensureDataDir() {
  if (!dataDirReady) {
    dataDirReady = mkdir(path.dirname(dbPath), { recursive: true });
  }
  await dataDirReady;
}

function sqliteArgs(sql, json = false) {
  const args = [];
  if (json) args.push("-json");
  args.push(dbPath);
  args.push(sql);
  return args;
}

export async function execSql(sql) {
  await ensureDataDir();
  await execFileAsync("sqlite3", [dbPath, `PRAGMA foreign_keys = ON;\nPRAGMA busy_timeout = 5000;\n${sql}`], { maxBuffer: 1024 * 1024 * 10 });
}

export async function querySql(sql) {
  await ensureDataDir();
  const { stdout } = await execFileAsync("sqlite3", sqliteArgs(`PRAGMA busy_timeout = 5000;\n${sql}`, true), { maxBuffer: 1024 * 1024 * 10 });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const idx = trimmed.lastIndexOf("\n[");
  try {
    const result = JSON.parse(idx >= 0 ? trimmed.slice(idx + 1) : trimmed);
    // Discard ghost row from PRAGMA busy_timeout when query produced zero rows.
    // (sqlite3 -json on "PRAGMA busy_timeout=...; SELECT ..." outputs [{"timeout":5000}] for zero-row cases)
    if (idx < 0 && Array.isArray(result) && result.length === 1 && "timeout" in result[0]) {
      return [];
    }
    return result;
  } catch {
    return [];
  }
}

export function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function sqlJson(value) {
  return sqlString(JSON.stringify(value ?? null));
}

export function newId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

async function auditDb(action, entityType, entityId, metadata = {}) {
  await execSql(`
    INSERT INTO audit_log (id, actor, action, entity_type, entity_id, metadata)
    VALUES (${sqlString(newId("audit"))}, 'system', ${sqlString(action)}, ${sqlString(entityType)}, ${sqlString(entityId)}, ${sqlJson(metadata)});
  `);
}

export async function initDb() {
  const [schema, seed] = await Promise.all([
    readFile(path.join(rootDir, "db", "schema.sql"), "utf8"),
    readFile(path.join(rootDir, "db", "seed.sql"), "utf8")
  ]);
  const schemaWithoutIndexes = schema
    .split("\n")
    .filter((line) => !line.trim().toUpperCase().startsWith("CREATE INDEX"))
    .join("\n");
  await execSql("PRAGMA journal_mode = WAL;");
  await execSql(schemaWithoutIndexes);
  await runMigrations();
  await execSql(schema);
  const existingSeedPersonas = await querySql(`
    SELECT id, user_edited, locked_from_seed_overwrite
    FROM personas
    WHERE id IN (${seedPersonaIds.map(sqlString).join(", ")});
  `);
  const existingById = new Map(existingSeedPersonas.map((row) => [row.id, row]));
  await execSql(seed);
  await execSql(`
    DELETE FROM persona_interests
    WHERE id IN (SELECT interest_id FROM persona_interest_deletions);
  `);
  await Promise.allSettled(seedPersonaIds.map(async (personaId) => {
    const existing = existingById.get(personaId);
    if (existing) {
      await auditDb("seed.skipped_existing_persona", "persona", personaId, { reason: "insert_only_seed" });
      await auditDb("persona.protected_from_seed", "persona", personaId, {
        userEdited: Boolean(existing.user_edited),
        lockedFromSeedOverwrite: Boolean(existing.locked_from_seed_overwrite)
      });
    } else {
      await auditDb("seed.inserted_missing_persona", "persona", personaId, { reason: "missing_default" });
    }
  }));
}

export function parseJsonField(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function getColumns(table) {
  const columns = await querySql(`PRAGMA table_info(${table});`);
  return new Set(columns.map((item) => item.name));
}

async function tableExists(table) {
  const rows = await querySql(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(table)} LIMIT 1;`);
  return rows.length > 0;
}

async function addMissingColumns(table, columnDefs) {
  if (!(await tableExists(table))) return;
  const columns = await getColumns(table);
  const statements = columnDefs
    .filter(({ column }) => !columns.has(column))
    .map(({ column, definition }) => `ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  if (statements.length) {
    await execSql(statements.join("\n"));
  }
}

async function runMigrations() {
  const migrations = [
    ["signals", [
      ["status", "TEXT NOT NULL DEFAULT 'new'"],
      ["reviewed_at", "TEXT"],
      ["dismissed_at", "TEXT"],
      ["used_at", "TEXT"],
      ["freshness_score", "INTEGER NOT NULL DEFAULT 0"],
      ["priority_score", "INTEGER NOT NULL DEFAULT 0"],
      ["source_count", "INTEGER NOT NULL DEFAULT 1"],
      ["cluster_id", "TEXT"],
      ["generated_by", "TEXT"],
      ["source_provider", "TEXT"],
      ["hermes_run_type", "TEXT"],
      ["hermes_provider", "TEXT"],
      ["hermes_model", "TEXT"],
      ["hermes_endpoint", "TEXT"],
      ["hermes_job_name", "TEXT"],
      ["validation_id", "TEXT"],
      ["review_reason", "TEXT"],
      ["dismissal_reason", "TEXT"],
      ["test_mode", "INTEGER NOT NULL DEFAULT 0"],
      ["editorial_metadata", "TEXT NOT NULL DEFAULT '{}'"]
    ]],
    ["ingestion_runs", [
      ["run_type", "TEXT NOT NULL DEFAULT 'mock'"],
      ["signals_created", "INTEGER NOT NULL DEFAULT 0"],
      ["source_count", "INTEGER NOT NULL DEFAULT 0"],
      ["candidate_count", "INTEGER NOT NULL DEFAULT 0"],
      ["cluster_count", "INTEGER NOT NULL DEFAULT 0"],
      ["signal_count", "INTEGER NOT NULL DEFAULT 0"],
      ["generated_by", "TEXT"],
      ["provider", "TEXT"],
      ["model", "TEXT"],
      ["endpoint", "TEXT"],
      ["job_name", "TEXT"],
      ["validation_id", "TEXT"],
      ["notes", "TEXT"],
      ["error_message", "TEXT"],
      ["summary", "TEXT"]
    ]],
    ["persona_queries", [
      ["provider", "TEXT NOT NULL DEFAULT 'news'"],
      ["weight", "INTEGER NOT NULL DEFAULT 1"],
      ["updated_at", "TEXT"],
      ["user_edited", "INTEGER NOT NULL DEFAULT 0"],
      ["user_edited_at", "TEXT"],
      ["locked_from_seed_overwrite", "INTEGER NOT NULL DEFAULT 0"]
    ]],
    ["personas", [
      ["voice_controls", "TEXT NOT NULL DEFAULT '{}'"],
      ["user_edited", "INTEGER NOT NULL DEFAULT 0"],
      ["user_edited_at", "TEXT"],
      ["locked_from_seed_overwrite", "INTEGER NOT NULL DEFAULT 0"]
    ]],
    ["persona_interest_deletions", [
      ["persona_id", "TEXT NOT NULL DEFAULT ''"],
      ["label", "TEXT"],
      ["deleted_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"]
    ]],
    ["drafts", [
      ["original_body", "TEXT"],
      ["edited_body", "TEXT"],
      ["platform", "TEXT NOT NULL DEFAULT 'x'"],
      ["media_refs", "TEXT NOT NULL DEFAULT '[]'"],
      ["hashtags", "TEXT NOT NULL DEFAULT '[]'"],
      ["status", "TEXT NOT NULL DEFAULT 'needs_review'"],
      ["review_reason", "TEXT"],
      ["rejection_reason", "TEXT"],
      ["quality_checks", "TEXT NOT NULL DEFAULT '{}'"],
      ["editorial_metadata", "TEXT NOT NULL DEFAULT '{}'"],
      ["source_signal_ids", "TEXT NOT NULL DEFAULT '[]'"],
      ["created_at", "TEXT"],
      ["updated_at", "TEXT"]
    ]],
    ["scheduled_posts", [
      ["media_refs", "TEXT NOT NULL DEFAULT '[]'"],
      ["hashtags", "TEXT NOT NULL DEFAULT '[]'"],
      ["source_signal_ids", "TEXT NOT NULL DEFAULT '[]'"],
      ["created_at", "TEXT"],
      ["updated_at", "TEXT"]
    ]],
    ["signal_snapshots", [
      ["freshness_score", "INTEGER NOT NULL DEFAULT 0"],
      ["priority_score", "INTEGER NOT NULL DEFAULT 0"],
      ["source_count", "INTEGER NOT NULL DEFAULT 1"],
      ["cluster_id", "TEXT"]
    ]]
  ];

  for (const [table, columns] of migrations) {
    await addMissingColumns(table, columns.map(([column, definition]) => ({ column, definition })));
  }

  await execSql(`
    CREATE TABLE IF NOT EXISTS hermes_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS velocity_alerts (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      alert_level TEXT NOT NULL,
      acceleration_score INTEGER NOT NULL,
      explanation TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      acknowledged_at TEXT,
      FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE,
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS published_posts (
      id TEXT PRIMARY KEY,
      scheduled_post_id TEXT,
      draft_id TEXT,
      persona_id TEXT,
      platform TEXT NOT NULL DEFAULT 'x',
      external_post_id TEXT,
      published_url TEXT,
      body TEXT NOT NULL,
      media_refs TEXT NOT NULL DEFAULT '[]',
      hashtags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'published_manual',
      published_at TEXT NOT NULL,
      source_signal_ids TEXT NOT NULL DEFAULT '[]',
      impressions INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      reposts INTEGER NOT NULL DEFAULT 0,
      replies INTEGER NOT NULL DEFAULT 0,
      bookmarks INTEGER NOT NULL DEFAULT 0,
      engagement_notes TEXT,
      performance_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (scheduled_post_id) REFERENCES scheduled_posts(id) ON DELETE SET NULL,
      FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE SET NULL,
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS operator_draft_choices (
      id TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL,
      signal_id TEXT,
      source_signal_ids TEXT NOT NULL DEFAULT '[]',
      draft_a TEXT NOT NULL,
      draft_b TEXT,
      selected_variant TEXT NOT NULL,
      edited_final_text TEXT NOT NULL,
      choice_reason TEXT,
      outcome TEXT NOT NULL DEFAULT 'recorded',
      scheduled_post_id TEXT,
      published_post_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (selected_variant IN ('A', 'B', 'neither')),
      CHECK (outcome IN ('recorded', 'scheduled', 'published', 'skipped')),
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE,
      FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE SET NULL,
      FOREIGN KEY (scheduled_post_id) REFERENCES scheduled_posts(id) ON DELETE SET NULL,
      FOREIGN KEY (published_post_id) REFERENCES published_posts(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL,
      entity_name TEXT,
      topic TEXT NOT NULL,
      signal_id TEXT,
      draft_count INTEGER NOT NULL DEFAULT 1,
      priority_score INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0.85,
      run_type TEXT,
      is_test INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE,
      FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE SET NULL
    );

    UPDATE drafts SET original_body = body WHERE original_body IS NULL;
    UPDATE drafts SET edited_body = body WHERE edited_body IS NULL;
    UPDATE drafts SET quality_checks = '{}' WHERE quality_checks IS NULL;
    UPDATE drafts SET editorial_metadata = '{}' WHERE editorial_metadata IS NULL;
    UPDATE signals SET editorial_metadata = '{}' WHERE editorial_metadata IS NULL;
    UPDATE scheduled_posts SET updated_at = created_at WHERE updated_at IS NULL;
    UPDATE persona_queries SET updated_at = created_at WHERE updated_at IS NULL;
    UPDATE persona_queries SET provider = 'rss' WHERE provider = 'news' AND source_type = 'public_feed';
    UPDATE personas
    SET platform_status = 'active', updated_at = CURRENT_TIMESTAMP
    WHERE platform_status = 'mock'
      AND COALESCE(user_edited, 0) = 0
      AND COALESCE(locked_from_seed_overwrite, 0) = 0;
    UPDATE platform_accounts SET status = 'configured' WHERE status = 'mock';
    CREATE TABLE IF NOT EXISTS persona_interests (
      id TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL,
      label TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS persona_interest_deletions (
      interest_id TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL,
      label TEXT,
      deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tracked_entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'person',
      primary_x_handle TEXT,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      github_urls_json TEXT NOT NULL DEFAULT '[]',
      website_urls_json TEXT NOT NULL DEFAULT '[]',
      rss_urls_json TEXT NOT NULL DEFAULT '[]',
      keywords_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS persona_entity_subscriptions (
      id TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 5,
      is_active INTEGER NOT NULL DEFAULT 1,
      monitor_x INTEGER NOT NULL DEFAULT 1,
      monitor_mentions INTEGER NOT NULL DEFAULT 1,
      monitor_rss INTEGER NOT NULL DEFAULT 1,
      monitor_crawl4ai INTEGER NOT NULL DEFAULT 1,
      monitor_searchagent INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES tracked_entities(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS persona_crawl_targets (
      id TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL,
      label TEXT,
      url TEXT NOT NULL,
      notes TEXT,
      frequency TEXT NOT NULL DEFAULT 'daily',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS persona_rss_topics (
      id TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'rss',
      weight INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
    );
    INSERT INTO persona_rss_topics (id, persona_id, topic, provider, weight)
    SELECT id, persona_id, query, provider, weight
    FROM persona_queries
    WHERE is_active = 1
      AND NOT EXISTS (SELECT 1 FROM persona_rss_topics WHERE persona_rss_topics.id = persona_queries.id);
    CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_signals_priority ON signals(priority_score, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_signal_snapshots_signal ON signal_snapshots(signal_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_ingestion_runs_generated_by ON ingestion_runs(generated_by, started_at);
    CREATE INDEX IF NOT EXISTS idx_velocity_alerts_signal ON velocity_alerts(signal_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_velocity_alerts_level ON velocity_alerts(alert_level, created_at);
    CREATE INDEX IF NOT EXISTS idx_published_posts_persona ON published_posts(persona_id, published_at);
    CREATE INDEX IF NOT EXISTS idx_published_posts_schedule ON published_posts(scheduled_post_id);
    CREATE INDEX IF NOT EXISTS idx_operator_draft_choices_persona ON operator_draft_choices(persona_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_operator_draft_choices_signal ON operator_draft_choices(signal_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_persona_interests_persona ON persona_interests(persona_id);
    CREATE INDEX IF NOT EXISTS idx_tracked_entities_type ON tracked_entities(type);
    CREATE INDEX IF NOT EXISTS idx_tracked_entities_name ON tracked_entities(name);
    CREATE INDEX IF NOT EXISTS idx_entity_subs_persona ON persona_entity_subscriptions(persona_id);
    CREATE INDEX IF NOT EXISTS idx_entity_subs_entity ON persona_entity_subscriptions(entity_id);
    CREATE INDEX IF NOT EXISTS idx_crawl_targets_persona ON persona_crawl_targets(persona_id);
    CREATE INDEX IF NOT EXISTS idx_rss_topics_persona ON persona_rss_topics(persona_id);
  `);
}
