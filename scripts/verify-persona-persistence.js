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
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `${path} returned ${response.status}`);
  return json;
}

let persona;
let original;
let createdQuery;

try {
  const personas = await api("/api/personas");
  persona = personas[0];
  if (!persona) throw new Error("No personas found");

  original = {
    name: persona.name,
    handle: persona.handle,
    niche: persona.niche,
    voiceTone: persona.voiceTone,
    platformStatus: persona.platformStatus === "mock" ? "active" : persona.platformStatus || "active"
  };

  const suffix = `Persistence ${Date.now()}`;
  const temporaryQueryText = `temporary persistence query ${Date.now()}`;
  const temporaryValues = {
    name: `${original.name} ${suffix}`,
    handle: String(original.handle || persona.account || "@persona").replace(/^@/, ""),
    niche: `${original.niche} Persistence check.`,
    voiceTone: `${original.voiceTone} Persistence check.`,
    platformStatus: "configured"
  };

  const patched = await api(`/api/personas/${persona.id}`, {
    method: "PATCH",
    body: JSON.stringify(temporaryValues)
  });
  addCheck("persona save returned persisted name", patched.name === temporaryValues.name, patched.name);
  addCheck("platform status saved without mock", patched.platformStatus === "configured", patched.platformStatus);

  const mockNormalized = await api(`/api/personas/${persona.id}`, {
    method: "PATCH",
    body: JSON.stringify({ platformStatus: "mock" })
  });
  addCheck("mock platform status normalizes to active", mockNormalized.platformStatus === "active", mockNormalized.platformStatus);

  await api(`/api/personas/${persona.id}`, {
    method: "PATCH",
    body: JSON.stringify({ platformStatus: "configured" })
  });

  const created = await api(`/api/personas/${persona.id}/queries`, {
    method: "POST",
    body: JSON.stringify({ query: temporaryQueryText, provider: "news", weight: 2 })
  });
  createdQuery = created.queries.find((query) => query.query === temporaryQueryText);
  addCheck("temporary query created", Boolean(createdQuery), createdQuery?.id || "missing");

  const persisted = await api(`/api/personas/${persona.id}`);
  addCheck("persona name persisted", persisted.name.includes(suffix), persisted.name);
  addCheck("handle normalized", String(persisted.handle || "").startsWith("@"), persisted.handle);
  addCheck("persona status persisted", persisted.platformStatus === "configured", persisted.platformStatus);
  addCheck("query visible on persona", persisted.queries.some((query) => query.query === temporaryQueryText), temporaryQueryText);

  if (createdQuery) {
    const deactivated = await api(`/api/personas/${persona.id}/queries/${createdQuery.id}/toggle`, { method: "PATCH", body: "{}" });
    addCheck(
      "temporary query deactivated",
      deactivated.queries.find((query) => query.id === createdQuery.id)?.isActive === false,
      createdQuery.id
    );

    const reactivated = await api(`/api/personas/${persona.id}/queries/${createdQuery.id}/toggle`, { method: "PATCH", body: "{}" });
    addCheck(
      "temporary query reactivated",
      reactivated.queries.find((query) => query.id === createdQuery.id)?.isActive === true,
      createdQuery.id
    );
  }

  const exported = await api("/api/hermes/export");
  const exportPersona = exported.personas.find((item) => item.id === persona.id);
  addCheck("Hermes export includes persona change", exportPersona?.name.includes(suffix), exportPersona?.name || "missing");
  addCheck("Hermes export includes platform status", exportPersona?.platformStatus === "configured", exportPersona?.platformStatus || "missing");
  addCheck("Hermes export includes query", exported.personaQueries.some((query) => query.id === createdQuery?.id), createdQuery?.id || "missing");
} catch (error) {
  report.pass = false;
  report.errors.push(error.message);
} finally {
  if (persona && createdQuery) {
    try {
      await api(`/api/personas/${persona.id}/queries/${createdQuery.id}`, { method: "DELETE" });
      const afterDelete = await api(`/api/personas/${persona.id}`);
      addCheck("temporary query deleted", !afterDelete.queries.some((query) => query.id === createdQuery.id), createdQuery.id);
    } catch (error) {
      report.pass = false;
      report.errors.push(`cleanup query failed: ${error.message}`);
    }
  }

  if (persona && original) {
    try {
      await api(`/api/personas/${persona.id}`, {
        method: "PATCH",
        body: JSON.stringify(original)
      });
      const restored = await api(`/api/personas/${persona.id}`);
      addCheck(
        "persona restored",
        restored.name === original.name && restored.handle === original.handle && restored.platformStatus === original.platformStatus,
        `${restored.name} ${restored.platformStatus}`
      );
    } catch (error) {
      report.pass = false;
      report.errors.push(`restore persona failed: ${error.message}`);
    }
  }
}

console.log(report.pass ? "PASS persona persistence verification" : "FAIL persona persistence verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
for (const error of report.errors) console.log(`ERROR - ${error}`);
process.exit(report.pass ? 0 : 1);
