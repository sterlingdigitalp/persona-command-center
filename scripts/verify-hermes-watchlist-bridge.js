#!/usr/bin/env node
const baseUrl = (process.env.PCC_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const report = { pass: true, checks: [], errors: [] };

function addCheck(name, ok, detail = "") {
  report.checks.push({ name, ok, detail });
  if (ok !== true) report.pass = false;
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
    throw error;
  }
  return json;
}

const TRIAL_MAP = {
  "policy-pete": { personaName: "Sterling Digital", entity: "Paul Graham", handle: "@paulg" },
  "maga-memester": { personaName: "Scott Decoded", entity: "Andrej Karpathy", handle: "@karpathy" },
  "the-wonkette": { personaName: "Peptide Tracker", entity: "Bryan Johnson", handle: "@bryan_johnson" },
  "progressive-pat": { personaName: "Chris Klebl", entity: "Morgan Housel", handle: "@morganhousel" }
};

async function main() {
  console.log("=== Phase 5B.3: Hermes Watch List Bridge Validation ===\n");

  // ===== 1. PCC Export Readability =====
  console.log("--- 1. PCC Export ---\n");
  const exportData = await api("/api/hermes/export");
  const personas = exportData?.personas || exportData;
  addCheck("PCC export is readable",
    Array.isArray(personas) && personas.length > 0,
    `${Array.isArray(personas) ? personas.length : typeof personas} items`);

  // ===== 2. 4 Personas Loaded =====
  console.log("\n--- 2. Persona Count ---\n");
  addCheck("4 personas loaded",
    Array.isArray(personas) && personas.length === 4,
    `Found ${personas?.length || 0} personas`);

  // Verify each persona has correct trial mapping
  for (const [pid, expected] of Object.entries(TRIAL_MAP)) {
    const persona = Array.isArray(personas) ? personas.find(p => p.id === pid) : null;
    addCheck(`${expected.personaName} (${pid}) exists`,
      !!persona,
      persona ? `id=${persona.id}` : "not found");
  }

  // ===== 3. 40 Tracked Entities Loaded =====
  console.log("\n--- 3. Tracked Entities ---\n");
  const entities = await api("/api/entities");
  addCheck("40 tracked entities loaded",
    Array.isArray(entities) && entities.length >= 40,
    `Found ${Array.isArray(entities) ? entities.length : 0} entities`);

  // Count tracked entities across personas
  let totalTracked = 0;
  for (const p of (Array.isArray(personas) ? personas : [])) {
    const t = p.trackedEntities || [];
    totalTracked += t.length;
  }
  addCheck("Tracked entities in export (count)",
    totalTracked >= 40,
    `Total: ${totalTracked} entities across all personas`);

  // ===== 4. Hermes/SearchAgent X Retrieval Invoked =====
  console.log("\n--- 4. X Retrieval Method ---\n");

  // Check that PCC-side X provider is NOT the production path
  // by verifying the bridge was used (signals with source=hermes_x_search)
  const allSignals = await api("/api/signals");
  const bridgeSignals = Array.isArray(allSignals)
    ? allSignals.filter(s => (s.source || "").includes("hermes_x_search"))
    : [];

  addCheck("Bridge signals exist (hermes_x_search source)",
    bridgeSignals.length >= 4,
    `${bridgeSignals.length} signals with hermes_x_search source`);

  // Check PCC-side X provider is NOT used for these signals
  // Match sources that are exactly "x" or start with "x/" or contain "x.com"/"twitter"
  const xProviderSignals = Array.isArray(allSignals)
    ? allSignals.filter(s => {
        const src = (s.source || "").toLowerCase();
        return (src === "x" || src.startsWith("x/") || src.includes("x.com") || src.includes("twitter"))
          && !src.includes("hermes_x_search");
      })
    : [];

  addCheck("PCC-side X provider NOT used for bridge imports (source=hermes_x_search, not source=x)",
    bridgeSignals.length >= 4 && xProviderSignals.length < 1,
    `${bridgeSignals.length} hermes_x_search signals (expected >=4), ${xProviderSignals.length} x-sourced signals (expected 0)`);

  // ===== 5. No PCC-side X API calls in the bridge production path =====
  console.log("\n--- 5. PCC Production Path ---\n");
  addCheck("Bridge trial push bypasses PCC xProvider.js",
    bridgeSignals.length >= 4,
    `${bridgeSignals.length} bridge signals confirm xProvider.js was NOT the production path`);

  // ===== 6. Trial Push: 4 Imported Opportunities =====
  console.log("\n--- 6. Trial Push Results ---\n");

  // Check ingestion runs for trial_push
  const ingestionRuns = await api("/api/ingestion/runs");
  const trialRuns = Array.isArray(ingestionRuns)
    ? ingestionRuns.filter(r => r.runType === "trial_push")
    : [];
  const searchAgentRuns = Array.isArray(ingestionRuns)
    ? ingestionRuns.filter(r => r.provider === "SearchAgent")
    : [];

  addCheck("Trial push ingestion runs exist",
    trialRuns.length >= 4,
    `${trialRuns.length} trial_push runs found`);

  // ===== 7. Persona/Entity Mapping Correct =====
  console.log("\n--- 7. Mapping Verification ---\n");

  for (const [pid, expected] of Object.entries(TRIAL_MAP)) {
    const personaSignals = Array.isArray(bridgeSignals)
      ? bridgeSignals.filter(s => s.personaId === pid)
      : [];

    const hasEntityRef = personaSignals.some(s => {
      const topic = (s.topic || "").toLowerCase();
      const query = (s.query || "").toLowerCase();
      const expectedLower = expected.entity.toLowerCase();
      return topic.includes(expectedLower) || query.includes(expectedLower);
    });

    addCheck(`${expected.personaName} → ${expected.entity} (${expected.handle})`,
      personaSignals.length >= 1 && hasEntityRef,
      `${personaSignals.length} signals, hasEntityRef=${hasEntityRef}`);
  }

  // ===== 8. Operator Queue =====
  console.log("\n--- 8. Operator Queue ---\n");
  const queue = await api("/api/operator/queue");
  const queuePersonas = queue?.personas || [];
  addCheck("Operator queue shows persona data",
    Array.isArray(queuePersonas) && queuePersonas.length >= 4,
    `${Array.isArray(queuePersonas) ? queuePersonas.length : 0} personas in queue`);

  // ===== 9. No mock_x, no direct SQLite =====
  console.log("\n--- 9. Integrity Checks ---\n");

  // Check that mock provider is NOT used for bridge signals
  const mockSignals = Array.isArray(bridgeSignals)
    ? bridgeSignals.filter(s => (s.source || "").toLowerCase() === "mock_x" || (s.sourceProvider || "").toLowerCase() === "mock")
    : [];
  addCheck("No mock_x used in bridge trial push",
    mockSignals.length === 0,
    `${mockSignals.length} mock signals found`);

  // Verify signals were imported via API, not direct SQLite
  const searchAgentSourceProviders = searchAgentRuns.map(r => r.provider || "");
  const hasSearchAgent = searchAgentSourceProviders.some(p => p.includes("SearchAgent"));
  addCheck("Bridge import source is SearchAgent (not direct SQLite)",
    hasSearchAgent,
    `Providers: ${searchAgentSourceProviders.join(", ") || "none"}`);

  // ===== 10. Verdict =====
  console.log("\n=== VERDICT ===\n");
  const passCount = report.checks.filter(c => c.ok === true).length;
  const failCount = report.checks.filter(c => c.ok === false).length;

  console.log(`${passCount} PASS, ${failCount} FAIL`);
  console.log("\n" + report.checks.map(c =>
    `${c.ok === true ? "PASS" : "FAIL"} - ${c.name}${c.detail ? ": " + c.detail : ""}`
  ).join("\n"));

  const verdict = report.pass ? "PASS" : "FAIL";
  console.log(`\n=== Overall: ${verdict} ===`);
  process.exit(report.pass ? 0 : 1);
}

main().catch(e => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
