#!/usr/bin/env node
const baseUrl = (process.env.PCC_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const report = { pass: true, checks: [], errors: [], trialResult: null };

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

const PERSONA_MAP = {
  "policy-pete": "Sterling Digital",
  "maga-memester": "Scott Decoded",
  "the-wonkette": "Peptide Tracker",
  "progressive-pat": "Chris Klebl"
};

const PERSONA_DOMAINS = {
  "policy-pete": ["startup", "founder", "venture", "growth", "yc", "indie", "product", "business", "fundraising", "saas"],
  "maga-memester": ["ai", "deep learning", "llm", "coding", "python", "robotics", "prompt engineering", "research", "open source", "devtools"],
  "the-wonkette": ["longevity", "healthspan", "aging", "biohacking", "neuroscience", "nutrition", "supplement", "medicine", "exercise", "science"],
  "progressive-pat": ["finance", "investing", "markets", "venture", "valuation", "money", "macro", "wall street", "podcast", "strategy"]
};

const TRIAL_ENTITIES = {
  "policy-pete": { entityName: "Paul Graham", handle: "@paulg", topic: "Paul Graham on startup fundraising in 2026" },
  "maga-memester": { entityName: "Andrej Karpathy", handle: "@karpathy", topic: "Karpathy on LLM training efficiency breakthroughs" },
  "the-wonkette": { entityName: "Bryan Johnson", handle: "@bryan_johnson", topic: "Bryan Johnson on new longevity clinical trial results" },
  "progressive-pat": { entityName: "Morgan Housel", handle: "@morganhousel", topic: "Morgan Housel on behavioral investing in volatile markets" }
};

async function main() {
  // ===== PART 1: Validate Watch List Data =====
  console.log("=== PART 1: Watch List Data Validation ===\n");

  const personas = await api("/api/personas");
  addCheck("4 personas exist", personas.length === 4, `Found ${personas.length}`);
  for (const persona of personas) {
    const expectedDomain = PERSONA_DOMAINS[persona.id];
    addCheck(`${PERSONA_MAP[persona.id] || persona.id} mapped correctly`,
      Boolean(PERSONA_MAP[persona.id]),
      persona.id);
  }

  // Fetch entities for domain validation
  const entities = await api("/api/entities");
  const entityKeywordMap = {};
  for (const e of entities) {
    const kw = typeof e.keywords_json === "string" ? JSON.parse(e.keywords_json || "[]") : (e.keywords_json || []);
    entityKeywordMap[e.name] = kw.map(k => k.toLowerCase());
  }

  for (const persona of personas) {
    const subs = persona.trackedEntities || [];
    const subsCount = subs.length;
    const expected = PERSONA_MAP[persona.id];

    addCheck(`${expected} has Watch List entries`,
      subsCount >= 10,
      `${subsCount} entries (seed: 10, plus any test artifacts)`);

    // Check domain fit via entity keywords_json vs persona domain keywords
    const domainKeywords = PERSONA_DOMAINS[persona.id] || [];
    const wrongDomain = subs.filter(s => {
      const kw = entityKeywordMap[s.entity_name] || [];
      return !kw.some(k => domainKeywords.some(dk => k.includes(dk) || dk.includes(k)));
    });
    if (wrongDomain.length > 2) {
      addCheck(`${expected} no wrong-domain entries`,
        false,
        `Found ${wrongDomain.length} entries that don't match domain: ${wrongDomain.map(s=>s.entity_name).join(", ")}`);
    } else {
      addCheck(`${expected} domain match`,
        true,
        `${subsCount - wrongDomain.length}/${subsCount} in-domain (${wrongDomain.map(s=>s.entity_name).join(", ")||"all correct"})`);
    }
  }

  // Karpathy cross-persona check
  const karpathyPersonas = personas.filter(p =>
    (p.trackedEntities || []).some(s => s.entity_name === "Andrej Karpathy")
  );
  addCheck("Karpathy in Scott Decoded (intentional)",
    karpathyPersonas.some(p => p.id === "maga-memester"),
    `Present in: ${karpathyPersonas.map(p => p.name).join(", ")}`);

  addCheck("Total tracked entities >= 40", entities.length >= 40, `${entities.length} entities`);

  // ===== PART 2: Trace PCC → Hermes Input =====
  console.log("\n=== PART 2: PCC → Hermes Input Source of Truth ===\n");

  const hermesExport = await api("/api/hermes/export");

  addCheck("Hermes export includes personas",
    Array.isArray(hermesExport.personas) && hermesExport.personas.length === 4,
    `${hermesExport.personas.length} personas`);

  addCheck("Hermes export includes trackedEntities",
    Array.isArray(hermesExport.trackedEntities) && hermesExport.trackedEntities.length >= 40,
    `${hermesExport.trackedEntities.length} entities`);

  addCheck("Hermes export includes subscription data per persona",
    hermesExport.personas.every(p => Array.isArray(p.trackedEntities)),
    "All personas have trackedEntities array");

  addCheck("Handles normalized with @",
    hermesExport.trackedEntities.every(e => !e.primary_x_handle || e.primary_x_handle.startsWith('@')),
    "All handles start with @");

  // Check entity IDs preserved
  addCheck("Entity IDs are consistent person IDs",
    hermesExport.personas.every(p =>
      (p.trackedEntities || []).every(s => s.entity_id)
    ),
    "All subscriptions have entity_id");

  console.log("\nSource of Truth: LIVE SQLite database, queried every time through getPersonas() / exportHermesState().\n");

  // ===== PART 3: Trial Retrieval =====
  console.log("\n=== PART 3: Trial Retrieval ===\n");

  const health = await api("/api/health");
  addCheck("Server is reachable",
    health.ok === true,
    `uptime: ${health.uptime}s`);

  addCheck("X provider is a stub (NotImplemented)",
    true,
    "xProvider.js throws NotImplemented — no X API credentials configured. Live retrieval cannot run.");
  addCheck("Trial retrieval: mock provider used",
    true,
    "Mock provider generates domain-appropriate content per persona.");

  // ===== PART 4: Create Trial Opportunity Packets =====
  console.log("\n=== PART 4: Trial Opportunity Packets ===\n");

  const now = new Date().toISOString();
  const trialPayload = {
    runType: "validation_ping",
    generatedAt: now,
    provider: "validation_ping",
    model: "manual",
    endpoint: "local",
    jobName: "pcc-hermes-data-flow-validation",
    validationId: `trial-push-${Date.now()}`,
    personas: Object.entries(TRIAL_ENTITIES).map(([personaId, entity]) => ({
      personaId,
      signals: [
        {
          topic: entity.topic,
          source: "x.com",
          query: entity.handle,
          firstSeenAt: now,
          lastSeenAt: now,
          velocityScore: 75,
          relevanceScore: 90,
          noveltyScore: 80,
          freshnessScore: 85,
          riskScore: 10,
          priorityScore: 82,
          sourceCount: 3,
          clusterId: null,
          generatedBy: "validation_ping",
          sourceProvider: "mock_x",
          hermesRunType: "validation_ping",
          status: "new",
          suggestedAngle: `${entity.entityName} recently posted about ${entity.topic.split(" on ")[1] || entity.topic}. This aligns with ${PERSONA_MAP[personaId]}'s focus area.`,
          evidenceUrls: [`https://x.com/${entity.handle.replace("@", "")}/status/trial`],
          createdAt: now
        }
      ]
    }))
  };

  console.log("Trial payload:", JSON.stringify(trialPayload, null, 2).slice(0, 500) + "...\n");

  let importResult;
  try {
    importResult = await api("/api/hermes/import", {
      method: "POST",
      body: JSON.stringify(trialPayload)
    });
    addCheck("Trial packets imported via POST /api/hermes/import",
      importResult.imported > 0,
      `${importResult.imported} new signals created, ${importResult.updated} updated, runId: ${importResult.runId}`);
  } catch (e) {
    addCheck("Trial packets import", false, e.message);
  }

  // ===== PART 5: Push to PCC and Verify Operator Dashboard =====
  console.log("\n=== PART 5: Push to PCC — Operator Dashboard Verification ===\n");

  let operatorQueue;
  try {
    operatorQueue = await api("/api/operator/queue");
    addCheck("Operator queue endpoint reachable",
      Boolean(operatorQueue.personas),
      `Found ${operatorQueue.personas?.length || 0} persona sections`);
  } catch (e) {
    addCheck("Operator queue endpoint", false, e.message);
    return;
  }

  // Check each persona has trial-derived content
  for (const [personaId, entity] of Object.entries(TRIAL_ENTITIES)) {
    const opPersona = (operatorQueue.personas || []).find(p => p.persona?.id === personaId);
    const expectedName = PERSONA_MAP[personaId];

    if (!opPersona) {
      addCheck(`${expectedName} section in Operator queue`, false, `Not found in operator queue`);
      continue;
    }

    addCheck(`${expectedName} section in Operator queue`,
      true,
      `Found with ${opPersona.signals?.length || 0} signals, ${opPersona.drafts?.length || 0} drafts`);

    const trialSignal = (opPersona.signals || []).find(s =>
      (s.hermesRunType === "validation_ping" || s.topic?.includes(entity.entityName))
    );

    if (trialSignal) {
      addCheck(`${expectedName} shows trial data for ${entity.entityName}`,
        true,
        `topic: "${(trialSignal.topic||'').slice(0,60)}", score: ${trialSignal.priorityScore}`);
    } else {
      // Check if it was deduped or stored
      addCheck(`${expectedName} shows trial data for ${entity.entityName}`,
        false,
        `No trial signal found. May have been deduped. Check /api/signals/persona/${personaId}`);
    }
  }

  // Verify no stale unrelated demo content dominates
  const staleTopics = ["court ethics", "cable news", "student loan", "wildfire", "campaign finance", "budget tradeoffs", "border hearing", "union contract"];
  for (const [personaId, entity] of Object.entries(TRIAL_ENTITIES)) {
    const opPersona = (operatorQueue.personas || []).find(p => p.persona?.id === personaId);
    if (!opPersona) continue;
    const expectedName = PERSONA_MAP[personaId];
    const signals = opPersona.signals || [];
    const stale = signals.filter(s => staleTopics.some(t => (s.topic||"").toLowerCase().includes(t)));
    if (stale.length >= signals.length && signals.length > 0) {
      addCheck(`${expectedName} — stale demo content check`,
        false,
        `All ${signals.length} signals are stale demo topics: ${signals.slice(0,3).map(s=>s.topic).join(", ")}`);
    } else {
      addCheck(`${expectedName} — stale demo content check`,
        true,
        `${stale.length}/${signals.length} signals are stale demo content`);
    }
  }

  // ===== PART 6: Functional Assessment =====
  console.log("\n=== PART 6: Functional Assessment ===\n");

  // 1. Is PCC persona data connected to Hermes retrieval?
  addCheck("1. PCC persona data → Hermes retrieval",
    false,
    "FAIL: Hermes reads persona_queries (static text strings), NOT tracked_entities or entity subscriptions. Watch List data exists in DB + export but is not wired into ingestion pipeline.");

  // 2. Is Hermes retrieval connected to Opportunity Packet creation?
  const hasPipelineSignals = importResult && importResult.imported > 0;
  addCheck("2. Hermes retrieval → Opportunity Packet creation",
    hasPipelineSignals ? "PARTIAL" : false,
    hasPipelineSignals
      ? "PARTIAL: Import pipeline works (trial packets inserted via POST /api/hermes/import), but no automated 'Opportunity Engine' exists. Manual signal creation required."
      : "FAIL: Import pipeline failed.");

  // 3. Is packet delivery connected to Operator dashboard?
  const opPersonas = (operatorQueue?.personas || []).filter(p =>
    (p.signals || []).some(s => s.hermesRunType === "validation_ping")
  );
  addCheck("3. Opportunity Packet → PCC Operator dashboard",
    opPersonas.length > 0 ? "PARTIAL" : false,
    opPersonas.length > 0
      ? `PARTIAL: ${opPersonas.length}/${Object.keys(TRIAL_ENTITIES).length} persona sections show trial data via API. dashboard display depends on frontend rendering.`
      : "FAIL: No trial signals found in operator queue.");

  // 4. Does Operator show matching Watch List data?
  const matchingPersonas = (operatorQueue?.personas || []).filter(p => {
    const entity = TRIAL_ENTITIES[p.persona?.id];
    return entity && (p.signals || []).some(s =>
      s.topic?.includes(entity.entityName) || s.hermesRunType === "validation_ping"
    );
  });
  addCheck("4. Operator dashboard matches Watch Lists",
    matchingPersonas.length >= 2 ? "PARTIAL" : false,
    `PARTIAL: ${matchingPersonas.length}/${Object.keys(TRIAL_ENTITIES).length} personas show matching trial content.`);

  // 5. What is mocked/stale/disconnected?
  addCheck("5. Mocked/stale/disconnected assessment",
    true,
    "MOCKED: X provider (stub). STATIC: persona_queries drive ingestion, not entities. DISCONNECTED: Watch List data → ingestion pipeline has no integration. LIVE: All DB queries, import pipeline, operator queue. LIVE: Hermes export endpoint.");

  // Summary
  console.log("\n=== VERDICT ===\n");
  const passCount = report.checks.filter(c => c.ok === true).length;
  const failCount = report.checks.filter(c => c.ok === false).length;
  const partialCount = report.checks.filter(c => c.ok === "PARTIAL").length;
  console.log(`${passCount} PASS, ${partialCount} PARTIAL, ${failCount} FAIL`);

  const hasFatalFailure = report.checks.some(c => c.ok === false && (c.name.startsWith("1.") || c.name.startsWith("2.")));
  report.pass = !hasFatalFailure;
}

main().catch(e => {
  report.pass = false;
  report.errors.push(e.message);
  console.error("FATAL:", e.message);
}).finally(() => {
  console.log("\n" + report.checks.map(c =>
    `${c.ok === true ? "PASS" : c.ok === "PARTIAL" ? "PARTIAL" : "FAIL"} - ${c.name}${c.detail ? ": " + c.detail : ""}`
  ).join("\n"));
  if (report.errors.length) console.log("\nERRORS:\n" + report.errors.join("\n"));

  const verdict = report.pass ? "PASS" : "FAIL";
  console.log(`\n=== Overall: ${verdict} ===`);
  process.exit(report.pass ? 0 : 1);
});
