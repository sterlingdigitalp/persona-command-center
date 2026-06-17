#!/usr/bin/env node
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
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(json.error || text || `${path} returned ${response.status}`);
    error.status = response.status;
    error.text = text;
    error.path = path;
    throw error;
  }
  return json;
}

function personaPath(personaId) {
  return `/api/personas/${encodeURIComponent(String(personaId))}`;
}

function queryPath(personaId, queryId) {
  return `${personaPath(personaId)}/queries/${encodeURIComponent(String(queryId))}`;
}

try {
  const personas = await api("/api/personas");
  addCheck("GET /api/personas returned personas", Array.isArray(personas) && personas.length > 0, String(personas.length || 0));

  for (const persona of personas) {
    const detailUrl = personaPath(persona.id);
    try {
      const detail = await api(detailUrl);
      addCheck(`GET ${detailUrl}`, detail.id === persona.id, `${detail.id} / ${detail.name}`);
    } catch (error) {
      addCheck(`GET ${detailUrl}`, false, `${error.status || "ERR"} ${error.text || error.message}`);
      continue;
    }

    const original = {
      name: persona.name,
      handle: persona.handle,
      niche: persona.niche,
      voiceTone: persona.voiceTone,
      platformStatus: persona.platformStatus || "active"
    };
    const marker = `Route Check ${Date.now()} ${persona.id}`;
    try {
      const patched = await api(detailUrl, {
        method: "PATCH",
        body: JSON.stringify({ ...original, name: `${original.name} ${marker}` })
      });
      addCheck(`PATCH ${detailUrl}`, patched.id === persona.id && patched.name.endsWith(marker), `${patched.id} / ${patched.name}`);
    } catch (error) {
      addCheck(`PATCH ${detailUrl}`, false, `${error.status || "ERR"} ${error.text || error.message}`);
    } finally {
      try {
        await api(detailUrl, {
          method: "PATCH",
          body: JSON.stringify(original)
        });
      } catch (error) {
        report.pass = false;
        report.errors.push(`restore ${detailUrl} failed: ${error.message}`);
      }
    }

    for (const query of persona.queries || []) {
      const url = queryPath(persona.id, query.id);
      try {
        const updatedPersona = await api(url, {
          method: "PATCH",
          body: JSON.stringify({
            query: query.query,
            provider: query.provider || "news",
            weight: query.weight || 1,
            isActive: query.isActive !== false
          })
        });
        const updatedQuery = (updatedPersona.queries || []).find((item) => item.id === query.id);
        addCheck(`PATCH ${url}`, Boolean(updatedQuery), updatedQuery?.query || "missing");
      } catch (error) {
        addCheck(`PATCH ${url}`, false, `${error.status || "ERR"} ${error.text || error.message}`);
      }
    }
  }
} catch (error) {
  report.pass = false;
  report.errors.push(error.message);
}

console.log(report.pass ? "PASS persona route verification" : "FAIL persona route verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
for (const error of report.errors) console.log(`ERROR - ${error}`);
process.exit(report.pass ? 0 : 1);
