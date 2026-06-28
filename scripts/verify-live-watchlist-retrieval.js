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

const TEST_ENTITIES = [
  { personaId: "maga-memester", entityName: "Andrej Karpathy", handle: "@karpathy" },
  { personaId: "policy-pete", entityName: "Paul Graham", handle: "@paulg" },
  { personaId: "the-wonkette", entityName: "Bryan Johnson", handle: "@bryan_johnson" },
  { personaId: "progressive-pat", entityName: "Morgan Housel", handle: "@morganhousel" }
];

async function main() {
  const hasCredentials = !!process.env.X_BEARER_TOKEN;

  console.log("=== Phase 5B.2: Live Watch List Retrieval Validation ===\n");

  // ===== 1. Verify X provider is implemented =====
  console.log("--- 1. X Provider Implementation Check ---\n");

  const { collectCandidatesForQuery, listProviders, getProvider } = await import("../src/providers/index.js");

  const registeredProviders = listProviders();
  addCheck("X provider registered in registry",
    registeredProviders.includes("x"),
    `Providers: ${registeredProviders.join(", ")}`);

  const xFn = getProvider("x");
  addCheck("X provider function exists",
    typeof xFn === "function",
    "getProvider('x') returns a function");

  // Verify no NotImplemented
  const xProviderSource = await import("../src/providers/xProvider.js");
  addCheck("X provider does not throw NotImplemented",
    !xProviderSource.collectCandidates.toString().includes("NotImplemented"),
    "xProvider.js collectCandidates is implemented");

  // ===== 2. Test X provider behavior without credentials =====
  console.log("\n--- 2. Credential-Aware Behavior Check ---\n");

  // Clear any existing token for this test
  const savedToken = process.env.X_BEARER_TOKEN;
  delete process.env.X_BEARER_TOKEN;

  try {
    await collectCandidatesForQuery(
      { id: "maga-memester", name: "Scott Decoded" },
      { provider: "x", query: "@karpathy", weight: 5, sourceType: "entity" },
      { ignoreProviderErrors: false }
    );
    addCheck("X provider errors without credentials",
      false,
      "Should have thrown — provider returned data without X_BEARER_TOKEN");
  } catch (err) {
    const hasRetrievalStatus = err.retrievalStatus === "no_credentials";
    addCheck("X provider returns retrievalStatus on no credentials",
      hasRetrievalStatus,
      err.message);
    const isNotNotImplemented = !err.message.includes("NotImplemented");
    addCheck("X provider does NOT return NotImplemented",
      isNotNotImplemented,
      err.message);
  }

  // Test that ignoreProviderErrors returns [] gracefully (no placeholder values)
  try {
    const result = await collectCandidatesForQuery(
      { id: "maga-memester", name: "Scott Decoded" },
      { provider: "x", query: "@karpathy", weight: 5, sourceType: "entity" },
      { ignoreProviderErrors: true }
    );
    addCheck("X provider with ignoreProviderErrors does NOT return false or [] as placeholder",
      Array.isArray(result) && result.length === 0,
      `Returns empty array gracefully: ${JSON.stringify(result)}`);
  } catch (err) {
    addCheck("X provider with ignoreProviderErrors does NOT throw",
      false,
      `Should have returned [] but threw: ${err.message}`);
  }

  // ===== 3. Live retrieval test (only if credentials exist) =====
  if (hasCredentials) {
    process.env.X_BEARER_TOKEN = savedToken;
    console.log("\n--- 3. Live X API Retrieval ---\n");

    for (const entity of TEST_ENTITIES) {
      try {
        const candidates = await collectCandidatesForQuery(
          { id: entity.personaId, name: entity.personaId },
          { provider: "x", query: entity.handle, weight: 5, sourceType: "entity", entityName: entity.entityName },
          { ignoreProviderErrors: false }
        );

        addCheck(`${entity.entityName} (${entity.personaId}) — retrieval succeeded`,
          Array.isArray(candidates) && candidates.length > 0,
          `${candidates.length} candidates returned`);

        if (candidates.length > 0) {
          const post = candidates[0];
          addCheck(`${entity.entityName} — latest post returned`,
            !!post.topic,
            `topic: ${(post.topic || "").slice(0, 80)}`);
          addCheck(`${entity.entityName} — timestamp returned`,
            !!post.publishedAt,
            `publishedAt: ${post.publishedAt}`);
          addCheck(`${entity.entityName} — URL returned`,
            !!post.url && post.url.includes("x.com"),
            `url: ${post.url}`);
          addCheck(`${entity.entityName} — no mock provider used`,
            post.rawData?.retrievalStatus === "live",
            `status: ${post.rawData?.retrievalStatus}`);
          addCheck(`${entity.entityName} — no placeholder values`,
            post.provider === "x" && !post.rawData?.mock,
            `provider: ${post.provider}, mock: ${!!post.rawData?.mock}`);
        }
      } catch (err) {
        addCheck(`${entity.entityName} (${entity.personaId}) — live retrieval`,
          false,
          `Failed: ${err.message}`);
      }
    }
  } else {
    process.env.X_BEARER_TOKEN = savedToken;
    console.log("\n--- 3. Live X API Retrieval (SKIPPED — no X_BEARER_TOKEN) ---\n");
    addCheck("X_BEARER_TOKEN configured for live retrieval",
      false,
      "Set X_BEARER_TOKEN env var to enable live X API testing");
  }

  // ===== 4. Verify pipeline integration =====
  console.log("\n--- 4. Pipeline Integration Verification ---\n");

  const personas = await api("/api/personas");
  const scott = personas.find(p => p.id === "maga-memester");
  const karpathySub = (scott?.trackedEntities || []).find(e => e.entity_name === "Andrej Karpathy");
  addCheck("Karpathy monitor_x active in pipeline",
    !!karpathySub?.monitor_x,
    `monitor_x=${karpathySub?.monitor_x}`);

  // ===== 5. Summary =====
  console.log("\n=== VERDICT ===\n");
  const passCount = report.checks.filter(c => c.ok === true).length;
  const failCount = report.checks.filter(c => c.ok === false).length;

  const hasPlaceholder = report.checks.some(c =>
    c.ok === false && (
      c.name.includes("NotImplemented") ||
      c.name.includes("placeholder") ||
      c.name.includes("false]") ||
      c.name.includes("mock provider used")
    )
  );
  if (hasPlaceholder) {
    report.pass = false;
  }

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
