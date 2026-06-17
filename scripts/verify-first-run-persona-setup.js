#!/usr/bin/env node
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const dbPath = path.join(rootDir, "work", "first-run-setup.sqlite");
const port = Number(process.env.PCC_FIRST_RUN_PORT || 3318);
const baseUrl = `http://127.0.0.1:${port}`;
const report = { pass: true, checks: [], errors: [] };

function addCheck(name, ok, detail = "") {
  report.checks.push({ name, ok, detail });
  if (!ok) report.pass = false;
}

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `${pathname} returned ${response.status}`);
  return json;
}

async function waitForServer(child) {
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    try {
      const health = await api("/api/health");
      if (health.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Server did not start. Logs:\n${logs}`);
}

const setupPersonas = [
  {
    name: "Civic Analyst",
    handle: "CivicAnalyst",
    niche: "Local government, courts, budgeting, and administrative process.",
    voiceTone: "Clear, practical, and institutionally fluent.",
    platformStatus: "active",
    queries: [
      { query: "city budget council oversight", provider: "news", weight: 3, isActive: true },
      { query: "state court ethics hearing", provider: "rss", weight: 3, isActive: true },
      { query: "public records watchdog", provider: "news", weight: 3, isActive: true }
    ]
  },
  {
    name: "Policy Builder",
    handle: "@PolicyBuilder",
    niche: "Policy implementation, tradeoffs, agencies, and measurable outcomes.",
    voiceTone: "Measured, explanatory, and useful.",
    platformStatus: "active",
    queries: [
      { query: "education policy implementation", provider: "news", weight: 3, isActive: true },
      { query: "healthcare cost regulation", provider: "rss", weight: 3, isActive: true },
      { query: "climate rule compliance", provider: "news", weight: 3, isActive: true }
    ]
  },
  {
    name: "Culture Decoder",
    handle: "CultureDecoder",
    niche: "Media narratives, viral political moments, and creator ecosystems.",
    voiceTone: "Fast, concise, and careful about claims.",
    platformStatus: "active",
    queries: [
      { query: "viral campaign clip media narrative", provider: "news", weight: 3, isActive: true },
      { query: "creator backlash politics", provider: "rss", weight: 3, isActive: true },
      { query: "brand controversy political media", provider: "news", weight: 3, isActive: true }
    ]
  },
  {
    name: "Organizing Desk",
    handle: "@OrganizingDesk",
    niche: "Labor, housing, healthcare, climate, and movement strategy.",
    voiceTone: "Grounded, values-led, and action-oriented.",
    platformStatus: "active",
    queries: [
      { query: "labor union contract campaign", provider: "news", weight: 3, isActive: true },
      { query: "housing affordability tenants", provider: "rss", weight: 3, isActive: true },
      { query: "clean energy jobs organizing", provider: "news", weight: 3, isActive: true }
    ]
  }
];

await rm(dbPath, { force: true });
const child = spawn("node", ["src/server.js"], {
  cwd: rootDir,
  env: {
    ...process.env,
    DB_PATH: dbPath,
    PORT: String(port),
    PCC_DISABLE_STARTUP_SIMULATION: "true"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForServer(child);

  const reset = await api("/api/setup/reset-personas", {
    method: "POST",
    body: JSON.stringify({ confirm: "DELETE_PERSONAS" })
  });
  addCheck("reset reports uninitialized", reset.personasInitialized === false && reset.personaCount === 0, JSON.stringify(reset));

  const emptyPersonas = await api("/api/personas");
  addCheck("GET /api/personas is empty after reset", Array.isArray(emptyPersonas) && emptyPersonas.length === 0, String(emptyPersonas.length));

  const emptyStatus = await api("/api/setup/status");
  addCheck("setup status reports empty", emptyStatus.backendReachable === true && emptyStatus.personasInitialized === false && emptyStatus.personaCount === 0, JSON.stringify(emptyStatus));

  const initialized = await api("/api/personas/initialize", {
    method: "POST",
    body: JSON.stringify({ personas: setupPersonas })
  });
  addCheck("initialize creates 4 personas", initialized.length === 4, String(initialized.length));
  addCheck("handles normalized during setup", initialized.every((persona) => String(persona.handle).startsWith("@")), initialized.map((persona) => persona.handle).join(", "));
  addCheck("queries created during setup", initialized.every((persona) => persona.queries.length === 3), initialized.map((persona) => persona.queries.length).join(", "));

  const repeated = await api("/api/personas/initialize", {
    method: "POST",
    body: JSON.stringify({ personas: setupPersonas })
  });
  const afterRepeat = await api("/api/personas");
  addCheck("repeated setup does not duplicate personas", repeated.length === 4 && afterRepeat.length === 4, String(afterRepeat.length));

  const exported = await api("/api/hermes/export");
  addCheck("Hermes export includes initialized personas", exported.personas.length === 4, String(exported.personas.length));
  addCheck("Hermes export includes initialized queries", exported.personaQueries.length === 12, String(exported.personaQueries.length));

  const first = afterRepeat[0];
  const patched = await api(`/api/personas/${first.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: `${first.name} Edited`,
      handle: "CivicAnalystEdited",
      niche: `${first.niche} Edited.`,
      voiceTone: `${first.voiceTone} Edited.`,
      platformStatus: "configured"
    })
  });
  addCheck("edit after setup persists", patched.name.endsWith("Edited") && patched.handle === "@CivicAnalystEdited", `${patched.name} ${patched.handle}`);

  const createdQueryPersona = await api(`/api/personas/${first.id}/queries`, {
    method: "POST",
    body: JSON.stringify({ query: "temporary first run query", provider: "news", weight: 2 })
  });
  const createdQuery = createdQueryPersona.queries.find((query) => query.query === "temporary first run query");
  addCheck("query add after setup persists", Boolean(createdQuery), createdQuery?.id || "missing");

  const updatedQueryPersona = await api(`/api/personas/${first.id}/queries/${createdQuery.id}`, {
    method: "PATCH",
    body: JSON.stringify({ query: "temporary first run query updated", provider: "rss", weight: 5 })
  });
  addCheck(
    "query edit after setup persists",
    updatedQueryPersona.queries.some((query) => query.id === createdQuery.id && query.provider === "rss" && query.weight === 5),
    createdQuery.id
  );

  const deletedQueryPersona = await api(`/api/personas/${first.id}/queries/${createdQuery.id}`, { method: "DELETE" });
  addCheck("query delete after setup persists", !deletedQueryPersona.queries.some((query) => query.id === createdQuery.id), createdQuery.id);
} catch (error) {
  report.pass = false;
  report.errors.push(error.message);
} finally {
  child.kill("SIGTERM");
}

console.log(report.pass ? "PASS first-run persona setup verification" : "FAIL first-run persona setup verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
for (const error of report.errors) console.log(`ERROR - ${error}`);
process.exit(report.pass ? 0 : 1);
