import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
export const dbPath = process.env.DB_PATH || path.join(rootDir, "data", "persona-command-center.sqlite");
const seedPersonaIds = ["the-wonkette", "policy-pete", "maga-memester", "progressive-pat"];

function sqliteArgs(sql, json = false) {
  const args = [];
  if (json) args.push("-json");
  args.push(dbPath);
  args.push(sql);
  return args;
}

export async function execSql(sql) {
  await mkdir(path.dirname(dbPath), { recursive: true });
  await execFileAsync("sqlite3", sqliteArgs(sql), { maxBuffer: 1024 * 1024 * 10 });
}

export async function querySql(sql) {
  await mkdir(path.dirname(dbPath), { recursive: true });
  const { stdout } = await execFileAsync("sqlite3", sqliteArgs(sql, true), { maxBuffer: 1024 * 1024 * 10 });
  return stdout.trim() ? JSON.parse(stdout) : [];
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
  const schema = await readFile(path.join(rootDir, "db", "schema.sql"), "utf8");
  const seed = await readFile(path.join(rootDir, "db", "seed.sql"), "utf8");
  await execSql(schema);
  await runMigrations();
  const existingSeedPersonas = await querySql(`
    SELECT id, user_edited, locked_from_seed_overwrite
    FROM personas
    WHERE id IN (${seedPersonaIds.map(sqlString).join(", ")});
  `);
  const existingById = new Map(existingSeedPersonas.map((row) => [row.id, row]));
  await execSql(seed);
  for (const personaId of seedPersonaIds) {
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
  }
}

export function parseJsonField(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function hasColumn(table, column) {
  const columns = await querySql(`PRAGMA table_info(${table});`);
  return columns.some((item) => item.name === column);
}

async function addColumnIfMissing(table, column, definition) {
  if (!(await hasColumn(table, column))) {
    await execSql(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

async function runMigrations() {
  await addColumnIfMissing("signals", "status", "TEXT NOT NULL DEFAULT 'new'");
  await addColumnIfMissing("signals", "reviewed_at", "TEXT");
  await addColumnIfMissing("signals", "dismissed_at", "TEXT");
  await addColumnIfMissing("signals", "used_at", "TEXT");
  await addColumnIfMissing("signals", "freshness_score", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("signals", "priority_score", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("signals", "source_count", "INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing("signals", "cluster_id", "TEXT");
  await addColumnIfMissing("signals", "generated_by", "TEXT");
  await addColumnIfMissing("signals", "source_provider", "TEXT");
  await addColumnIfMissing("signals", "hermes_run_type", "TEXT");
  await addColumnIfMissing("signals", "hermes_provider", "TEXT");
  await addColumnIfMissing("signals", "hermes_model", "TEXT");
  await addColumnIfMissing("signals", "hermes_endpoint", "TEXT");
  await addColumnIfMissing("signals", "hermes_job_name", "TEXT");
  await addColumnIfMissing("signals", "validation_id", "TEXT");

  await addColumnIfMissing("ingestion_runs", "run_type", "TEXT NOT NULL DEFAULT 'mock'");
  await addColumnIfMissing("ingestion_runs", "signals_created", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("ingestion_runs", "source_count", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("ingestion_runs", "candidate_count", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("ingestion_runs", "cluster_count", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("ingestion_runs", "signal_count", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("ingestion_runs", "generated_by", "TEXT");
  await addColumnIfMissing("ingestion_runs", "provider", "TEXT");
  await addColumnIfMissing("ingestion_runs", "model", "TEXT");
  await addColumnIfMissing("ingestion_runs", "endpoint", "TEXT");
  await addColumnIfMissing("ingestion_runs", "job_name", "TEXT");
  await addColumnIfMissing("ingestion_runs", "validation_id", "TEXT");
  await addColumnIfMissing("ingestion_runs", "notes", "TEXT");
  await addColumnIfMissing("ingestion_runs", "error_message", "TEXT");

  await addColumnIfMissing("persona_queries", "provider", "TEXT NOT NULL DEFAULT 'news'");
  await addColumnIfMissing("persona_queries", "weight", "INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing("persona_queries", "updated_at", "TEXT");
  await addColumnIfMissing("persona_queries", "user_edited", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("persona_queries", "user_edited_at", "TEXT");
  await addColumnIfMissing("persona_queries", "locked_from_seed_overwrite", "INTEGER NOT NULL DEFAULT 0");

  await addColumnIfMissing("personas", "user_edited", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("personas", "user_edited_at", "TEXT");
  await addColumnIfMissing("personas", "locked_from_seed_overwrite", "INTEGER NOT NULL DEFAULT 0");

  await addColumnIfMissing("drafts", "original_body", "TEXT");
  await addColumnIfMissing("drafts", "edited_body", "TEXT");
  await addColumnIfMissing("drafts", "platform", "TEXT NOT NULL DEFAULT 'x'");

  await addColumnIfMissing("scheduled_posts", "updated_at", "TEXT");

  await addColumnIfMissing("signal_snapshots", "freshness_score", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("signal_snapshots", "priority_score", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("signal_snapshots", "source_count", "INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing("signal_snapshots", "cluster_id", "TEXT");

  await execSql(`
    CREATE TABLE IF NOT EXISTS hermes_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await execSql(`
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
  `);

  await execSql(`
    UPDATE drafts SET original_body = body WHERE original_body IS NULL;
    UPDATE drafts SET edited_body = body WHERE edited_body IS NULL;
    UPDATE scheduled_posts SET updated_at = created_at WHERE updated_at IS NULL;
    UPDATE persona_queries SET updated_at = created_at WHERE updated_at IS NULL;
    UPDATE personas
    SET platform_status = 'active', updated_at = CURRENT_TIMESTAMP
    WHERE platform_status = 'mock'
      AND COALESCE(user_edited, 0) = 0
      AND COALESCE(locked_from_seed_overwrite, 0) = 0;
    UPDATE platform_accounts SET status = 'configured' WHERE status = 'mock';
    CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_signals_priority ON signals(priority_score, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_signal_snapshots_signal ON signal_snapshots(signal_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_ingestion_runs_generated_by ON ingestion_runs(generated_by, started_at);
    CREATE INDEX IF NOT EXISTS idx_velocity_alerts_signal ON velocity_alerts(signal_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_velocity_alerts_level ON velocity_alerts(alert_level, created_at);
  `);
}
