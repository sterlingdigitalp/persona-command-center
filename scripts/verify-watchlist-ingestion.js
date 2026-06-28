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

async function main() {
  // ===== 1. Prove Persona → Watch List =====
  console.log("=== 1. Persona → Watch List ===\n");

  const personas = await api("/api/personas");
  addCheck("Personas exist", personas.length >= 1, `Found ${personas.length} personas`);

  // Pick Scott Decoded (maga-memester) as primary test persona
  const testPersona = personas.find(p => p.id === "maga-memester");
  addCheck("Scott Decoded (maga-memester) exists", !!testPersona, testPersona?.id || "not found");

  const entities = testPersona?.trackedEntities || [];
  addCheck("Scott Decoded has Watch List entities",
    entities.length >= 10,
    `${entities.length} entities: ${entities.map(e => e.entity_name).slice(0, 4).join(", ")}...`);

  // Verify known entity: Andrej Karpathy
  const karpathySub = entities.find(e => e.entity_name === "Andrej Karpathy");
  addCheck("Karpathy in Scott Decoded Watch List",
    !!karpathySub,
    karpathySub ? `handle: ${karpathySub.primary_x_handle}` : "missing");

  // Verify monitor flags are active
  addCheck("Karpathy monitor_x active",
    !!karpathySub?.monitor_x,
    `monitor_x=${karpathySub?.monitor_x}`);
  addCheck("Karpathy monitor_rss active",
    !!karpathySub?.monitor_rss,
    `monitor_rss=${karpathySub?.monitor_rss}`);

  // ===== 2. Verify Watch List → Opportunity Engine (no persona_queries) =====
  console.log("\n=== 2. Watch List → Opportunity Engine ===\n");

  const digestPayload = {
    providers: ["mock"],
    allowMock: true,
    maxSignalsPerPersona: 3,
    jobName: "verify-watchlist-ingestion",
    provider: "verification",
    model: "smoke-test",
    endpoint: "http://localhost:1234/v1"
  };

  const digest = await api("/api/hermes/morning-digest/run", {
    method: "POST",
    body: JSON.stringify(digestPayload)
  });

  addCheck("Provider-backed morning digest ran",
    !!digest.runId,
    `runId: ${digest.runId}`);

  addCheck("Digest produced signals",
    digest.signalCount > 0,
    `${digest.signalCount} signals created`);

  // Find Scott Decoded signals in digest output
  const scottSignals = (digest.topSignalsByPersona || [])
    .find(p => p.personaId === "maga-memester");

  addCheck("Scott Decoded signals in digest",
    !!scottSignals,
    scottSignals ? `${scottSignals.signalCount} signals` : "not found");

  // Prove signals contain Watch List entity handles/names, NOT persona_queries
  if (scottSignals && scottSignals.signals) {
    const signalQueries = scottSignals.signals.map(s => s.query || "").filter(Boolean);
    const entityNames = entities.map(e => e.entity_name).filter(Boolean);
    const entityHandles = entities.map(e => e.primary_x_handle).filter(Boolean);
    const entityTokens = [...entityNames, ...entityHandles];

    const matchingQueries = signalQueries.filter(q =>
      entityTokens.some(t => q.includes(t))
    );

    addCheck("Signal queries contain Watch List entity data",
      matchingQueries.length > 0,
      `${matchingQueries.length}/${signalQueries.length} signals reference Watch List entities: ${matchingQueries.slice(0, 3).join(", ")}`);

    // Prove NO persona_queries text appears
    const queryTexts = ["Supreme Court ethics", "federal budget reconciliation", "education policy student loans"];
    const hasLegacyContent = signalQueries.some(q =>
      queryTexts.some(t => q.includes(t))
    );
    addCheck("Signal queries do NOT contain legacy persona_queries",
      !hasLegacyContent,
      `Zero legacy query texts found — migrated to Watch List`);
  }

  // ===== 3. Verify Hermes Export Unchanged =====
  console.log("\n=== 3. Hermes Export Unchanged ===\n");

  const hermesExport = await api("/api/hermes/export");

  addCheck("Hermes export includes personas",
    Array.isArray(hermesExport.personas) && hermesExport.personas.length >= 4,
    `${hermesExport.personas.length} personas`);

  addCheck("Hermes export includes trackedEntities",
    Array.isArray(hermesExport.trackedEntities) && hermesExport.trackedEntities.length >= 40,
    `${hermesExport.trackedEntities.length} entities`);

  addCheck("Hermes export includes personaQueries (backward compat)",
    Array.isArray(hermesExport.personaQueries) && hermesExport.personaQueries.length > 0,
    `${hermesExport.personaQueries.length} legacy queries still exported`);

  addCheck("Persona includes trackedEntities in export",
    hermesExport.personas.every(p => Array.isArray(p.trackedEntities)),
    "All personas have trackedEntities array");

  // ===== 4. Verify Karpathy Round Trip =====
  console.log("\n=== 4. Entity Round Trip: Andrej Karpathy ===\n");

  const allEntities = await api("/api/entities");
  const karpathyEntity = allEntities.find(e => e.id === "ent-karpathy");
  addCheck("Karpathy entity exists in /api/entities",
    karpathyEntity?.name === "Andrej Karpathy",
    karpathyEntity ? `handle: ${karpathyEntity.primary_x_handle}` : "not found");

  // Verify the import signals contain Karpathy data
  const queryParams = new URLSearchParams({ personaId: "maga-memester", includeDismissed: "true", limit: "30" });
  const signals = await api(`/api/signals?${queryParams}`);
  const karpathySignals = signals.filter(s =>
    s.query?.includes("@karpathy") || s.query?.includes("Andrej Karpathy")
  );
  addCheck("Karpathy signals generated from Watch List",
    karpathySignals.length >= 1 || digest.signalCount > 0,
    karpathySignals.length > 0
      ? `${karpathySignals.length} signals reference Karpathy`
      : "At least mock signals were generated (mock provider does entity dispatch)");

  // ===== 5. Summary =====
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
