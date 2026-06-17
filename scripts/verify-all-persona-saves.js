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
    throw error;
  }
  return json;
}

function personaPath(personaId) {
  return `/api/personas/${encodeURIComponent(String(personaId))}`;
}

let personas = [];

try {
  const health = await api("/api/health");
  addCheck("backend reachable", health.ok === true, JSON.stringify(health));

  personas = await api("/api/personas");
  addCheck("personas returned", Array.isArray(personas) && personas.length > 0, String(personas.length || 0));

  for (const persona of personas) {
    const original = {
      name: persona.name,
      handle: persona.handle,
      niche: persona.niche,
      voiceTone: persona.voiceTone,
      platformStatus: persona.platformStatus || "active"
    };
    const marker = `Save Check ${Date.now()} ${persona.id}`;
    try {
      const patched = await api(personaPath(persona.id), {
        method: "PATCH",
        body: JSON.stringify({ ...original, name: `${original.name} ${marker}` })
      });
      const fetched = await api(personaPath(persona.id));
      const ok = patched.name.endsWith(marker) && fetched.name.endsWith(marker);
      addCheck(`save ${persona.id} / ${persona.name}`, ok, fetched.name);
    } catch (error) {
      addCheck(`save ${persona.id} / ${persona.name}`, false, `${error.status || "ERR"} ${error.text || error.message}`);
    } finally {
      try {
        await api(personaPath(persona.id), {
          method: "PATCH",
          body: JSON.stringify(original)
        });
      } catch (error) {
        report.pass = false;
        report.errors.push(`restore ${persona.id} failed: ${error.message}`);
      }
    }
  }
} catch (error) {
  report.pass = false;
  report.errors.push(error.message);
}

console.log(report.pass ? "PASS all persona save verification" : "FAIL all persona save verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
for (const error of report.errors) console.log(`ERROR - ${error}`);
process.exit(report.pass ? 0 : 1);
