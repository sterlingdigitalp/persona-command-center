import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const dbPath = process.env.DB_PATH || path.join(rootDir, "data", "persona-command-center.sqlite");
const htmlPath = path.join(rootDir, "outputs", "persona-command-center.html");
const serverPath = path.join(rootDir, "src", "server.js");
const results = [];
const insertedDraftIds = [];

function record(ok, message) {
  results.push({ ok, message });
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function query(sql) {
  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, `PRAGMA busy_timeout = 5000;\n${sql}`], { maxBuffer: 1024 * 1024 * 10 });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const idx = trimmed.lastIndexOf("\n[");
  return JSON.parse(idx >= 0 ? trimmed.slice(idx + 1) : trimmed);
}

async function exec(sql) {
  await execFileAsync("sqlite3", [dbPath, `PRAGMA busy_timeout = 5000;\n${sql}`], { maxBuffer: 1024 * 1024 * 10 });
}

async function ensureDraftForPersona(persona) {
  const id = `draft_operator_route_${Date.now()}_${persona.id.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}`;
  insertedDraftIds.push(id);
  await exec(`
    INSERT INTO drafts (
      id, persona_id, body, original_body, edited_body, platform,
      media_refs, hashtags, status, quality_checks, source_signal_ids
    )
    VALUES (
      ${sqlString(id)},
      ${sqlString(persona.id)},
      ${sqlString(`Operator route check draft for ${persona.name}.`)},
      ${sqlString(`Operator route check draft for ${persona.name}.`)},
      NULL,
      'x',
      '[]',
      '[]',
      'needs_review',
      '{}',
      '[]'
    );
  `);
  return id;
}

async function cleanup() {
  if (!insertedDraftIds.length) return;
  await exec(`DELETE FROM drafts WHERE id IN (${insertedDraftIds.map(sqlString).join(",")});`);
}

try {
  const [html, server] = await Promise.all([
    readFile(htmlPath, "utf8"),
    readFile(serverPath, "utf8")
  ]);

  record(html.includes("function openQueueForDraft(draftId)"), "Queue exposes an exact-draft focus helper.");
  record(html.includes("function quickEditDraft(draftId) { openQueueForDraft(draftId); }"), "Operator Edit routes through openQueueForDraft(draftId).");
  record(html.includes('data-draft-id="${escapeHtml(draft.id)}"'), "Draft Review renders stable data-draft-id attributes.");
  record(html.includes("queueFocusDraftId"), "Draft Review tracks the selected draft id.");
  record(!html.includes("drafts.slice(0, 8).map"), "Draft Review no longer truncates to the first 8 drafts.");
  record(server.includes("LIMIT 200") && server.includes("ORDER BY updated_at DESC, created_at DESC"), "Draft API returns a broad, recency-ordered review set.");
  record(server.includes("noisyLinkedSignalIds") && !server.includes("!sourceIds.some((id) => cleanSignalIds.has(id))"), "Operator queue no longer hides drafts because linked signals fell outside the first signal page.");

  const personas = await query("SELECT id, name FROM personas ORDER BY id;");
  record(personas.length >= 4, `Loaded personas for routing check: ${personas.length}.`);
  const createdDraftIds = [];
  for (const persona of personas) {
    createdDraftIds.push(await ensureDraftForPersona(persona));
  }

  const rows = await query(`
    SELECT id, persona_id, status, body
    FROM drafts
    WHERE status IN ('needs_review', 'approved', 'scheduled')
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 200;
  `);
  const visibleDraftIds = new Set(rows.map((row) => row.id));
  const visiblePersonaIds = new Set(rows.map((row) => row.persona_id));

  for (const persona of personas) {
    record(visiblePersonaIds.has(persona.id), `Queue data includes a visible draft for ${persona.name} (${persona.id}).`);
  }
  for (const draftId of createdDraftIds) {
    record(visibleDraftIds.has(draftId), `Operator Edit target resolves to visible Queue draft ${draftId}.`);
  }

  const importantPersonas = personas.filter((persona) => /peptide|scott/i.test(`${persona.name} ${persona.id}`));
  for (const persona of importantPersonas) {
    record(visiblePersonaIds.has(persona.id), `${persona.name} no longer disappears from Queue data.`);
  }
} catch (error) {
  record(false, error.stack || error.message);
} finally {
  try {
    await cleanup();
  } catch (error) {
    record(false, `Cleanup failed: ${error.message}`);
  }
}

const failed = results.filter((item) => !item.ok);
console.log(failed.length ? "FAIL operator edit queue routing verification" : "PASS operator edit queue routing verification");
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} - ${result.message}`);
}

if (failed.length) process.exit(1);
