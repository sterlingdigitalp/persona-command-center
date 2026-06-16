#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseUrl = (process.env.PCC_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const report = { pass: true, checks: [], errors: [] };

function addCheck(name, ok, detail = "") {
  report.checks.push({ name, ok, detail });
  if (!ok) report.pass = false;
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `${path} returned ${response.status}`);
  return json;
}

async function rerunInitDb() {
  await execFileAsync(process.execPath, ["scripts/init-db.js"], {
    env: process.env,
    maxBuffer: 1024 * 1024 * 10
  });
}

let persona;
let originalPersona;
let query;
let originalQuery;

try {
  const health = await api("/api/health");
  addCheck("backend reachable", health.ok === true, JSON.stringify(health));

  const personas = await api("/api/personas");
  persona = personas[0];
  if (!persona) throw new Error("No personas available to verify");

  originalPersona = {
    name: persona.name,
    handle: persona.handle,
    niche: persona.niche,
    voiceTone: persona.voiceTone,
    platformStatus: persona.platformStatus || "active"
  };
  query = (persona.queries || [])[0];
  if (!query) throw new Error(`Persona ${persona.id} has no query to verify`);
  originalQuery = {
    query: query.query,
    provider: query.provider || "news",
    weight: query.weight || 1,
    isActive: query.isActive !== false
  };

  const marker = `Protection ${Date.now()}`;
  const protectedPersonaPayload = {
    name: `${originalPersona.name} ${marker}`,
    handle: originalPersona.handle,
    niche: `${originalPersona.niche} ${marker}.`,
    voiceTone: `${originalPersona.voiceTone} ${marker}.`,
    platformStatus: "configured"
  };
  const protectedQueryPayload = {
    query: `${originalQuery.query} ${marker}`,
    provider: originalQuery.provider === "news" ? "rss" : "news",
    weight: originalQuery.weight === 5 ? 4 : 5,
    isActive: true
  };

  const patchedPersona = await api(`/api/personas/${persona.id}`, {
    method: "PATCH",
    body: JSON.stringify(protectedPersonaPayload)
  });
  addCheck("persona edit marked protected", patchedPersona.userEdited === true && patchedPersona.lockedFromSeedOverwrite === true);

  const patchedQueryPersona = await api(`/api/personas/${persona.id}/queries/${query.id}`, {
    method: "PATCH",
    body: JSON.stringify(protectedQueryPayload)
  });
  const patchedQuery = patchedQueryPersona.queries.find((item) => item.id === query.id);
  addCheck("query edit marked protected", patchedQuery?.userEdited === true && patchedQuery?.lockedFromSeedOverwrite === true);

  await rerunInitDb();

  const afterInit = await api(`/api/personas/${persona.id}`);
  addCheck("seed/init did not overwrite persona name", afterInit.name === protectedPersonaPayload.name, afterInit.name);
  addCheck("seed/init did not overwrite persona status", afterInit.platformStatus === protectedPersonaPayload.platformStatus, afterInit.platformStatus);
  const afterInitQuery = afterInit.queries.find((item) => item.id === query.id);
  addCheck("seed/init did not overwrite query text", afterInitQuery?.query === protectedQueryPayload.query, afterInitQuery?.query || "missing");
  addCheck("seed/init did not overwrite query provider/weight", afterInitQuery?.provider === protectedQueryPayload.provider && afterInitQuery?.weight === protectedQueryPayload.weight, `${afterInitQuery?.provider} ${afterInitQuery?.weight}`);

  const hermesExport = await api("/api/hermes/export");
  const exportPersona = hermesExport.personas.find((item) => item.id === persona.id);
  const exportQuery = hermesExport.personaQueries.find((item) => item.id === query.id);
  addCheck("Hermes export uses protected persona", exportPersona?.name === protectedPersonaPayload.name, exportPersona?.name || "missing");
  addCheck("Hermes export uses protected query", exportQuery?.query === protectedQueryPayload.query, exportQuery?.query || "missing");

  const audit = await api("/api/audit-log?limit=100");
  addCheck(
    "seed protection audit events exist",
    audit.some((event) => event.action === "seed.skipped_existing_persona" || event.action === "persona.protected_from_seed"),
    audit.slice(0, 5).map((event) => event.action).join(", ")
  );
} catch (error) {
  report.pass = false;
  report.errors.push(error.message);
} finally {
  if (persona && query && originalQuery) {
    try {
      await api(`/api/personas/${persona.id}/queries/${query.id}`, {
        method: "PATCH",
        body: JSON.stringify(originalQuery)
      });
      addCheck("query restored", true, query.id);
    } catch (error) {
      report.pass = false;
      report.errors.push(`restore query failed: ${error.message}`);
    }
  }
  if (persona && originalPersona) {
    try {
      await api(`/api/personas/${persona.id}`, {
        method: "PATCH",
        body: JSON.stringify(originalPersona)
      });
      const restored = await api(`/api/personas/${persona.id}`);
      addCheck("persona restored", restored.name === originalPersona.name && restored.handle === originalPersona.handle, restored.name);
    } catch (error) {
      report.pass = false;
      report.errors.push(`restore persona failed: ${error.message}`);
    }
  }
}

console.log(report.pass ? "PASS persona data protection verification" : "FAIL persona data protection verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
for (const error of report.errors) console.log(`ERROR - ${error}`);
process.exit(report.pass ? 0 : 1);
