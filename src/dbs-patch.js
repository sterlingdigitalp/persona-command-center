import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
export const dbPath =
  process.env.DB_PATH ||
  path.join(rootDir, "data", "persona-command-center.sqlite");

const seedPersonaIds = [
  "the-wonkette",
  "policy-pete",
  "maga-memester",
  "progressive-pat",
];

// Cache the mkdir call — the data directory exists after the first call and
// we don't need to stat it on every single query.
let dataDirReady = false;
async function ensureDataDir() {
  if (!dataDirReady) {
    await mkdir(path.dirname(dbPath), { recursive: true });
    dataDirReady = true;
  }
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
  await execFileAsync("sqlite3", sqliteArgs(sql), {
    maxBuffer: 1024 * 1024 * 10,
  });
}

export async function querySql(sql) {
  await ensureDataDir();
  const { stdout } = await execFileAsync("sqlite3", sqliteArgs(sql, true), {
    maxBuffer: 1024 * 1024 * 10,
  });
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

export function parseJsonField(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Schema introspection helpers
// ---------------------------------------------------------------------------

// Load ALL column names for a table in one PRAGMA call, then check membership
// in JS — avoids one subprocess per column during migrations.
async function getColumns(table) {
  const rows = await querySql(`PRAGMA table_info(${table});`);
  return new Set(rows.map((r) => r.name));
}

// Build ALTER TABLE statements only for truly missing columns, then execute
// them in a single batched call if there are any. Reduces subprocess count
// from (tables × columns) to (tables + 1 per table that needs changes).
async function addMissingColumns(table, columnDefs) {
  const existing = await getColumns(table);
  const missing = columnDefs.filter(([col]) => !existing.has(col));
  if (!missing.length) return;
  const alters = missing
    .map(([col, def]) => `ALTER TABLE ${table} ADD COLUMN ${col} ${def};`)
    .join("\n");
  await execSql(alters);
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

async function runMigrations() {
  // Run migrations for each table in parallel — they operate on different
  // tables and there are no cross-table dependencies within this phase.
  await Promise.all([
    addMissingColumns("signals", [
      ["status",          "TEXT NOT NULL DEFAULT 'new'"],
      ["reviewed_at",     "TEXT"],
      ["dismissed_at",    "TEXT"],
      ["used_at",         "TEXT"],
      ["freshness_score", "INTEGER NOT NULL DEFAULT 0"],
      ["priority_score",  "INTEGER NOT NULL DEFAULT 0"],
      ["source_count",    "INTEGER NOT NULL DEFAULT 1"],
      ["cluster_id",      "TEXT"],
      ["generated_by",    "TEXT"],
      ["source_provider", "TEXT"],
      ["hermes_run_type", "TEXT"],
      ["hermes_provider", "TEXT"],
      ["hermes_model",    "TEXT"],
      ["hermes_endpoint", "TEXT"],
      ["hermes_job_name", "TEXT"],
      ["validation_id",   "TEXT"],
    ]),

    addMissingColumns("ingestion_runs", [
      ["run_type",        "TEXT NOT NULL DEFAULT 'mock'"],
      ["signals_created", "INTEGER NOT NULL DEFAULT 0"],
      ["source_count",    "INTEGER NOT NULL DEFAULT 0"],
      ["candidate_count", "INTEGER NOT NULL DEFAULT 0"],
      ["cluster_count",   "INTEGER NOT NULL DEFAULT 0"],
      ["signal_count",    "INTEGER NOT NULL DEFAULT 0"],
      ["generated_by",    "TEXT"],
      ["provider",        "TEXT"],
      ["model",           "TEXT"],
      ["endpoint",        "TEXT"],
      ["job_name",        "TEXT"],
      ["validation_id",   "TEXT"],
      ["notes",           "TEXT"],
      ["error_message",   "TEXT"],
    ]),

    addMissingColumns("persona_queries", [
      ["provider",                   "TEXT NOT NULL DEFAULT 'news'"],
      ["weight",                     "INTEGER NOT NULL DEFAULT 1"],
      ["updated_at",                 "TEXT"],
      ["user_edited",                "INTEGER NOT NULL DEFAULT 0"],
      ["user_edited_at",             "TEXT"],
      ["locked_from_seed_overwrite", "INTEGER NOT NULL DEFAULT 0"],
    ]),

    addMissingColumns("personas", [
      ["user_edited",                "INTEGER NOT NULL DEFAULT 0"],
      ["user_edited_at",             "TEXT"],
      ["locked_from_seed_overwrite", "INTEGER NOT NULL DEFAULT 0"],
    ]),

    addMissingColumns("drafts", [
      ["original_body", "TEXT"],
      ["edited_body",   "TEXT"],
      ["platform",      "TEXT NOT NULL DEFAULT 'x'"],
    ]),

    addMissingColumns("scheduled_posts", [
      ["updated_at", "TEXT"],
    ]),

    addMissingColumns("signal_snapshots", [
      ["freshness_score", "INTEGER NOT NULL DEFAULT 0"],
      ["priority_score",  "INTEGER NOT NULL DEFAULT 0"],
      ["source_count",    "INTEGER NOT NULL DEFAULT 1"],
      ["cluster_id",      "TEXT"],
    ]),
  ]);

  // DDL statements that are idempotent (IF NOT EXISTS / ON CONFLICT) and
  // don't depend on the column additions above — run after all ALTERs settle.
  await execSql(`
    CREATE TABLE IF NOT EXISTS hermes_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS velocity_alerts (
      id                TEXT PRIMARY KEY,
      signal_id         TEXT NOT NULL,
      persona_id        TEXT NOT NULL,
      alert_level       TEXT NOT NULL,
      acceleration_score INTEGER NOT NULL,
      explanation       TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      acknowledged      INTEGER NOT NULL DEFAULT 0,
      acknowledged_at   TEXT,
      FOREIGN KEY (signal_id)  REFERENCES signals(id)  ON DELETE CASCADE,
      FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE
    );

    UPDATE drafts          SET original_body = body        WHERE original_body IS NULL;
    UPDATE drafts          SET edited_body   = body        WHERE edited_body   IS NULL;
    UPDATE scheduled_posts SET updated_at    = created_at  WHERE updated_at    IS NULL;
    UPDATE persona_queries SET updated_at    = created_at  WHERE updated_at    IS NULL;

    UPDATE personas
      SET platform_status = 'active', updated_at = CURRENT_TIMESTAMP
      WHERE platform_status = 'mock'
        AND COALESCE(user_edited, 0) = 0
        AND COALESCE(locked_from_seed_overwrite, 0) = 0;

    UPDATE platform_accounts SET status = 'configured' WHERE status = 'mock';

    CREATE INDEX IF NOT EXISTS idx_signals_status          ON signals(status, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_drafts_status           ON drafts(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_signals_priority        ON signals(priority_score, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_signal_snapshots_signal ON signal_snapshots(signal_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_ingestion_runs_generated_by ON ingestion_runs(generated_by, started_at);
    CREATE INDEX IF NOT EXISTS idx_velocity_alerts_signal  ON velocity_alerts(signal_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_velocity_alerts_level   ON velocity_alerts(alert_level, created_at);
  `);
}

// ---------------------------------------------------------------------------
// Public init entry point
// ---------------------------------------------------------------------------

export async function initDb() {
  const [schema, seed] = await Promise.all([
    readFile(path.join(rootDir, "db", "schema.sql"), "utf8"),
    readFile(path.join(rootDir, "db", "seed.sql"), "utf8"),
  ]);

  await execSql(schema);
  await runMigrations();

  const existingSeedPersonas = await querySql(`
    SELECT id, user_edited, locked_from_seed_overwrite
    FROM personas
    WHERE id IN (${seedPersonaIds.map(sqlString).join(", ")});
  `);
  const existingById = new Map(
    existingSeedPersonas.map((row) => [row.id, row])
  );

  await execSql(seed);

  // Audit inserts for seed personas can run concurrently.
  await Promise.allSettled(
    seedPersonaIds.map(async (personaId) => {
      const existing = existingById.get(personaId);
      if (existing) {
        await auditDb("seed.skipped_existing_persona", "persona", personaId, {
          reason: "insert_only_seed",
        });
        await auditDb("persona.protected_from_seed", "persona", personaId, {
          userEdited: Boolean(existing.user_edited),
          lockedFromSeedOverwrite: Boolean(existing.locked_from_seed_overwrite),
        });
      } else {
        await auditDb("seed.inserted_missing_persona", "persona", personaId, {
          reason: "missing_default",
        });
      }
    })
  );
}
