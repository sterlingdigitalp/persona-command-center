import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { selectMorningDigestSignals } from "../src/hermes/chiefOfStaff.js";
import { calculateAcceleration } from "../src/velocity/accelerationEngine.js";
import { filterFreshCandidates, isFreshCandidate, isMockSource } from "../src/ingestion/freshnessFilter.js";
import { generateSuggestedAngle } from "../src/ingestion/angleEngine.js";
import { clusterCandidates } from "../src/ingestion/cluster.js";
import { dedupeCandidates } from "../src/ingestion/dedupe.js";
import { scoreCluster } from "../src/ingestion/scoring.js";
import { validateHermesPayload } from "../src/hermes/hermesClient.js";
import { parseFeed } from "../src/providers/rssProvider.js";
import { registerProvider, getProvider, listProviders, collectCandidatesForQuery } from "../src/providers/index.js";
import { getDefaultProviders } from "../config/defaultProviders.js";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const dbPath = path.join(rootDir, "work", "smoke-test.sqlite");
const port = 3199;

await rm(dbPath, { force: true });

// === Regression tests for querySql PRAGMA busy_timeout ghost row bugfix ===
await (async () => {
  const ghostTestDb = path.join(rootDir, "work", "ghost-row-regression.sqlite");
  await rm(ghostTestDb, { force: true });
  process.env.DB_PATH = ghostTestDb;
  const dbMod = await import("../src/db.js");
  const { querySql: q, execSql: e } = dbMod;
  // minimal table
  await e("CREATE TABLE IF NOT EXISTS ghost_test (id TEXT PRIMARY KEY);");
  // zero-row SELECT must return [] not [{"timeout":5000}]
  const zero = await q("SELECT * FROM ghost_test WHERE id='no-such-id-12345';");
  assert(Array.isArray(zero) && zero.length === 0, "querySql on zero-row SELECT must return [] (not PRAGMA ghost row)");
  // one-row must return real data
  await e("INSERT INTO ghost_test (id) VALUES ('real1');");
  const one = await q("SELECT * FROM ghost_test WHERE id='real1';");
  assert(Array.isArray(one) && one.length === 1 && one[0].id === "real1", "querySql on one-row SELECT must return real row");
  // cleanup
  await rm(ghostTestDb, { force: true });
  // restore? server will override with its env
  delete process.env.DB_PATH;
  console.log("querySql ghost row regression: passed");
})();

const sampleFeed = `<?xml version="1.0"?><rss><channel>
  <item><title>Labor unions win housing affordability pledge</title><link>https://example.test/a</link><description>Workers and tenants push rent control policy.</description><pubDate>Tue, 16 Jun 2026 12:00:00 GMT</pubDate></item>
  <item><title>Labor unions win housing affordability pledge</title><link>https://example.test/a?ref=dup</link><description>Duplicate story.</description><pubDate>Tue, 16 Jun 2026 12:05:00 GMT</pubDate></item>
  <item><title>Student loans policy rollout faces implementation reality</title><link>https://example.test/b</link><description>Education policy details are changing.</description><pubDate>Tue, 16 Jun 2026 12:10:00 GMT</pubDate></item>
</channel></rss>`;

const parsedCandidates = parseFeed(sampleFeed, { query: "labor unions housing affordability", provider: "rss", source: "sample" });
assert(parsedCandidates.length === 3, "RSS parser should normalize feed items");
const filterNow = new Date("2026-06-16T12:00:00.000Z");
assert(isFreshCandidate({
  title: "Fresh labor story",
  source: "real-news.example",
  url: "https://real-news.example/fresh",
  publishedAt: "2026-06-16T10:00:00.000Z"
}, { now: filterNow }), "freshnessFilter should accept recent candidates");
assert(!isFreshCandidate({
  title: "Old labor story",
  source: "real-news.example",
  url: "https://real-news.example/old",
  publishedAt: "2026-06-10T10:00:00.000Z"
}, { now: filterNow }), "freshnessFilter should reject old publishedAt");
assert(!isFreshCandidate({
  title: "Missing date story",
  source: "real-news.example",
  url: "https://real-news.example/missing"
}, { now: filterNow }), "freshnessFilter should reject missing publishedAt by default");
assert(isMockSource({
  title: "Mock story",
  source: "mock-public-news.example",
  url: "https://mock-public-news.example/story",
  publishedAt: "2026-06-16T10:00:00.000Z"
}), "freshnessFilter should detect mock sources");
const filteredFixtureCandidates = filterFreshCandidates(parsedCandidates, { now: filterNow });
assert(filteredFixtureCandidates.counts.mockFilteredCount === 3, "freshnessFilter should reject example.test fixture sources");
const dedupedCandidates = dedupeCandidates(parsedCandidates);
assert(dedupedCandidates.length === 2, "dedupe should collapse duplicate URLs");
const clusters = clusterCandidates(dedupedCandidates);
assert(clusters.length === 2, "clustering should group similar stories");
const score = scoreCluster(
  { id: "progressive-pat", niche: "labor unions housing affordability", name: "ProgressivePat" },
  { query: "labor unions housing affordability", weight: 3 },
  clusters[0],
  []
);
assert(score.priorityScore > 0 && score.freshnessScore >= 0, "scoring should produce component and priority scores");
const angle = generateSuggestedAngle({ id: "progressive-pat", name: "ProgressivePat" }, clusters[0]);
assert(angle.includes("ProgressivePat"), "angle generation should be persona-aware");
const chiefSelection = selectMorningDigestSignals(
  [{ id: "policy-pete", name: "PolicyPete" }],
  new Map([["policy-pete", [
    { topic: "Budget implication one", priorityScore: 95, riskScore: 10 },
    { topic: "Budget implication one updated", priorityScore: 94, riskScore: 10 },
    { topic: "Education implementation reality", priorityScore: 90, riskScore: 12 },
    { topic: "High risk item", priorityScore: 99, riskScore: 90 }
  ]]]),
  2
);
assert(chiefSelection[0].selectedSignals.length === 2, "Chief of Staff should respect maxSignalsPerPersona");
assert(!chiefSelection[0].selectedSignals.some((signal) => signal.topic === "High risk item"), "Chief of Staff should skip high-risk signals");
const acceleration = calculateAcceleration([
  { sourceCount: 2, priorityScore: 60, velocityScore: 45 },
  { sourceCount: 12, priorityScore: 88, velocityScore: 86 }
]);
assert(acceleration.accelerationScore >= 90, "acceleration engine should identify viral windows");
assert(acceleration.alertLevel === "viral_window", "acceleration engine should assign alert levels");
try {
  validateHermesPayload({ runType: "bad", personas: [] });
  throw new Error("invalid Hermes payload should fail validation");
} catch (error) {
  assert(error.status === 400, "invalid Hermes payload should produce a validation error");
}

// Provider Registry Tests (Phase 4G)
const registered = listProviders();
assert(registered.includes("rss"), "registry must list rss");
assert(registered.includes("news"), "registry must list news");
assert(registered.includes("mock"), "registry must list mock");
assert(registered.includes("crawl4ai"), "registry must list future crawl4ai stub");
assert(registered.includes("x"), "registry must list future x stub");
assert(registered.includes("reddit"), "registry must list future reddit stub");

const rssFn = getProvider("rss");
assert(typeof rssFn === "function", "getProvider('rss') must return the collect function");

const defaults = getDefaultProviders();
assert(Array.isArray(defaults) && defaults.length > 0, "defaultProviders must return array");
assert(!defaults.includes("crawl4ai"), "defaultProviders must not include unimplemented stubs by default");

// Unknown provider must throw clear error
try {
  await collectCandidatesForQuery({ id: "test" }, { provider: "nonexistent", query: "foo" });
  throw new Error("unknown provider should have thrown");
} catch (err) {
  assert(err.message.includes("Unknown provider"), "unknown provider error must mention 'Unknown provider'");
  assert(err.message.includes("Registered providers"), "unknown provider error must list registered");
}

// Contract: providers expose collectCandidates via registry
const newsFn = getProvider("news");
assert(typeof newsFn === "function", "news provider must be registered");

// Stubs must throw NotImplemented when invoked
const c4x = await collectCandidatesForQuery({ id: "x" }, { provider: "crawl4ai", query: "test" });
assert(Array.isArray(c4x) && c4x.length > 0 && c4x[0].provider === "crawl4ai", "crawl4ai should return mock results without endpoint configured");


const server = spawn(process.execPath, ["src/server.js"], {
  cwd: rootDir,
  env: {
    ...process.env,
    PORT: String(port),
    DB_PATH: dbPath,
    DISABLE_HERMES_BOOTSTRAP: "1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let logs = "";
server.stdout.on("data", (chunk) => {
  logs += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  logs += chunk.toString();
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} failed: ${JSON.stringify(json)}`);
  return json;
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Server did not start. Logs:\n${logs}`);
}

async function runNodeScript(scriptPath, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, output }));
  });
}

try {
  await waitForServer();

  const health = await api("/api/health");
  assert(health.ok === true, "health endpoint should return ok");
  assert(health.phase === 4, "health endpoint should report phase 4");
  try {
    await api("/api/setup/reset-personas", {
      method: "POST",
      body: JSON.stringify({ confirm: "RESET_PERSONAS" })
    });
    throw new Error("legacy reset confirmation should fail");
  } catch (error) {
    assert(error.message.includes("DELETE_PERSONAS"), "destructive reset should require DELETE_PERSONAS confirmation");
  }

  const personas = await api("/api/personas");
  assert(personas.length === 4, "expected four seeded personas");
  assert(personas.some((persona) => persona.name === "The Wonkette"), "expected The Wonkette seed");
  assert(personas.every((persona) => persona.platformStatus !== "mock"), "seeded personas should not use mock platform status");
  for (const persona of personas) {
    const detail = await api(`/api/personas/${encodeURIComponent(persona.id)}`);
    assert(detail.id === persona.id, `persona detail route should work for ${persona.id}`);
  }

  // regression: get missing persona returns 404 not ghost object (querySql zero row)
  let missingPersonaErr = null;
  try {
    await api("/api/personas/definitely-missing-ghost-row-test-id-abc123");
  } catch (e) { missingPersonaErr = e; }
  assert(missingPersonaErr && (missingPersonaErr.message.includes("404") || missingPersonaErr.message.includes("Not found") || missingPersonaErr.message.includes("failed")), "getPersonaById missing must 404, not return ghost row data");

  // regression: getPublishedPosts with non-matching filter returns [] not ghost
  const emptyPubs = await fetch(`http://127.0.0.1:${port}/api/published-posts?scheduledPostId=missing-sched-ghost-xyz`, {
    headers: { "content-type": "application/json" }
  }).then(r => r.json());
  assert(Array.isArray(emptyPubs) && emptyPubs.length === 0, "getPublishedPosts(missing scheduledPostId) must return []");
  const policyPete = personas.find((persona) => persona.id === "policy-pete");
  assert(policyPete, "policy-pete should exist in seeded personas");
  const policyPeteDetail = await api("/api/personas/policy-pete");
  assert(policyPeteDetail.id === "policy-pete", "policy-pete detail endpoint should work");
  const policyPetePatched = await api("/api/personas/policy-pete", {
    method: "PATCH",
    body: JSON.stringify({
      name: "PolicyPete Route Check",
      handle: policyPete.handle,
      niche: policyPete.niche,
      voiceTone: policyPete.voiceTone,
      platformStatus: policyPete.platformStatus || "active"
    })
  });
  assert(policyPetePatched.id === "policy-pete" && policyPetePatched.name === "PolicyPete Route Check", "policy-pete PATCH endpoint should work");
  await api("/api/personas/policy-pete", {
    method: "PATCH",
    body: JSON.stringify({
      name: policyPete.name,
      handle: policyPete.handle,
      niche: policyPete.niche,
      voiceTone: policyPete.voiceTone,
      platformStatus: policyPete.platformStatus || "active"
    })
  });
  const budgetQuery = (policyPete.queries || []).find((query) => query.id === "q-pete-budget");
  assert(budgetQuery, "q-pete-budget should exist for policy-pete");
  const patchedBudgetQueryPersona = await api("/api/personas/policy-pete/queries/q-pete-budget", {
    method: "PATCH",
    body: JSON.stringify({
      query: "federal budget reconciliation tax credits",
      provider: "news",
      weight: 1,
      isActive: true
    })
  });
  assert(
    patchedBudgetQueryPersona.queries.some((query) => query.id === "q-pete-budget" && query.query === "federal budget reconciliation tax credits"),
    "policy-pete q-pete-budget PATCH endpoint should work"
  );

  const updatedPersona = await api(`/api/personas/${personas[0].id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: "Smoke Persona Name",
      handle: "SmokeHandle",
      niche: "Smoke-test niche for policy and culture",
      voiceTone: "Updated smoke-test voice",
      platformStatus: "mock"
    })
  });
  assert(updatedPersona.name === "Smoke Persona Name", "persona name should persist");
  assert(updatedPersona.handle === "@SmokeHandle", "persona handle should normalize and persist");
  assert(updatedPersona.niche === "Smoke-test niche for policy and culture", "persona niche should persist");
  assert(updatedPersona.voiceTone === "Updated smoke-test voice", "persona voice should persist");
  assert(updatedPersona.platformStatus === "active", "persona platform status should normalize mock to active");
  assert(updatedPersona.userEdited === true, "persona edit should mark userEdited");
  assert(updatedPersona.lockedFromSeedOverwrite === true, "persona edit should lock seed overwrite");

  const configuredPersona = await api(`/api/personas/${personas[0].id}`, {
    method: "PATCH",
    body: JSON.stringify({ platformStatus: "configured" })
  });
  assert(configuredPersona.platformStatus === "configured", "persona platform status should persist configured");

  const fetchedPersona = await api(`/api/personas/${personas[0].id}`);
  assert(fetchedPersona.handle === "@SmokeHandle", "GET persona by id should return persisted handle");
  assert(fetchedPersona.platformStatus === "configured", "GET persona by id should return persisted platform status");

  const addedQueryPersona = await api(`/api/personas/${personas[0].id}/queries`, {
    method: "POST",
    body: JSON.stringify({ query: "smoke added query", provider: "news", weight: 2 })
  });
  const addedQuery = addedQueryPersona.queries.find((query) => query.query === "smoke added query");
  assert(addedQuery, "persona query add should persist");
  const patchedQueryPersona = await api(`/api/personas/${personas[0].id}/queries/${addedQuery.id}`, {
    method: "PATCH",
    body: JSON.stringify({ query: "smoke updated active query", provider: "rss", weight: 5, isActive: true })
  });
  const patchedQuery = patchedQueryPersona.queries.find((query) => query.id === addedQuery.id);
  assert(patchedQuery.query === "smoke updated active query", "persona query patch should persist query text");
  assert(patchedQuery.provider === "rss", "persona query patch should persist provider");
  assert(patchedQuery.weight === 5, "persona query patch should persist weight");
  assert(patchedQuery.userEdited === true, "persona query patch should mark userEdited");
  assert(patchedQuery.lockedFromSeedOverwrite === true, "persona query patch should lock seed overwrite");
  const toggledQueryPersona = await api(`/api/personas/${personas[0].id}/queries/${addedQuery.id}/toggle`, { method: "PATCH", body: "{}" });
  assert(toggledQueryPersona.queries.find((query) => query.id === addedQuery.id).isActive === false, "persona query toggle should deactivate query");
  const reactivatedQueryPersona = await api(`/api/personas/${personas[0].id}/queries/${addedQuery.id}/toggle`, { method: "PATCH", body: "{}" });
  assert(reactivatedQueryPersona.queries.find((query) => query.id === addedQuery.id).isActive === true, "persona query toggle should reactivate query");
  for (const query of reactivatedQueryPersona.queries) {
    if (query.id !== addedQuery.id && query.isActive) {
      await api(`/api/personas/${personas[0].id}/queries/${query.id}/toggle`, { method: "PATCH", body: "{}" });
    }
  }

  const ingestion = await api("/api/ingestion/run", {
    method: "POST",
    body: JSON.stringify({ useMockProviders: true })
  });
  assert(ingestion.signals.length === 12, "expected mock ingestion to create 12 signals");
  assert(ingestion.candidateCount >= 12, "ingestion should report candidate count");
  assert(ingestion.clusterCount >= 12, "ingestion should report cluster count");
  assert(ingestion.signals.every((signal) => signal.priorityScore > 0), "signals should include priority scores");
  assert(ingestion.signals.every((signal) => signal.freshnessScore >= 0), "signals should include freshness scores");
  assert(ingestion.signals.every((signal) => signal.sourceCount >= 1), "signals should include source counts");

  const hermesSettings = await api("/api/hermes/settings");
  assert(hermesSettings.simulationModeEnabled === true, "Hermes simulation mode should be enabled by default");

  const hermesExport = await api("/api/hermes/export");
  assert(hermesExport.contractVersion === "2026-06-phase4a", "Hermes export should include contract version");
  assert(hermesExport.personas.length === 4, "Hermes export should include personas");
  assert(hermesExport.personaQueries.length >= 4, "Hermes export should include persona queries");
  assert(hermesExport.personas.some((persona) => persona.id === personas[0].id && persona.handle === "@SmokeHandle"), "Hermes export should reflect updated persona fields");
  assert(hermesExport.personas.some((persona) => persona.id === personas[0].id && persona.platformStatus === "configured"), "Hermes export should reflect updated platform status");
  assert(hermesExport.personaQueries.some((query) => query.id === addedQuery.id && query.query === "smoke updated active query"), "Hermes export should reflect updated persona query");

  const updatedHermesSettings = await api("/api/hermes/settings", {
    method: "PATCH",
    body: JSON.stringify({ eveningScanEnabled: false, archiveAfterDays: 3 })
  });
  assert(updatedHermesSettings.eveningScanEnabled === false, "Hermes settings update should persist");
  assert(updatedHermesSettings.archiveAfterDays === 3, "Hermes archive setting should persist");

  const simulated = await api("/api/hermes/simulate", {
    method: "POST",
    body: JSON.stringify({ runType: "morning_digest" })
  });
  assert(simulated.imported > 0, "Hermes simulation should import signals");
  assert(simulated.payload.provider === "lmstudio", "Hermes simulation payload should include provider attribution");
  assert(simulated.payload.model === "qwen3.6-35b-a3b-mtp", "Hermes simulation payload should include model attribution");
  assert(simulated.payload.endpoint === "http://localhost:1234/v1", "Hermes simulation payload should include endpoint attribution");
  assert(simulated.payload.jobName === "persona-command-center-morning_digest", "Hermes simulation payload should include job name attribution");

  const duplicateImport = await api("/api/hermes/import", {
    method: "POST",
    body: JSON.stringify(simulated.payload)
  });
  assert(duplicateImport.updated > 0, "Hermes duplicate import should update existing signals");

  const morningSignals = await api("/api/signals?includeDismissed=true&limit=100");
  const morningSignalWithAttribution = morningSignals.find((signal) => signal.generatedBy === "Hermes" && signal.hermesRunType === "morning_digest");
  assert(morningSignalWithAttribution, "morning_digest import should create Hermes-generated signals");
  assert(morningSignalWithAttribution.hermesProvider === "lmstudio", "morning_digest provider attribution should persist");
  assert(morningSignalWithAttribution.hermesModel === "qwen3.6-35b-a3b-mtp", "morning_digest model attribution should persist");
  assert(morningSignalWithAttribution.hermesEndpoint === "http://localhost:1234/v1", "morning_digest endpoint attribution should persist");
  assert(morningSignalWithAttribution.hermesJobName === "persona-command-center-morning_digest", "morning_digest job name attribution should persist");

  const overrideImport = await api("/api/hermes/import", {
    method: "POST",
    body: JSON.stringify({
      version: "2026-06-phase4a",
      runType: "morning_digest",
      provider: "top-level-provider",
      model: "top-level-model",
      endpoint: "http://top-level-endpoint/v1",
      jobName: "top-level-job",
      generatedAt: new Date().toISOString(),
      personas: [
        {
          personaId: "policy-pete",
          signals: [
            {
              topic: "Hermes Override Attribution Signal",
              source: "Hermes",
              provider: "signal-provider",
              model: "signal-model",
              endpoint: "http://signal-endpoint/v1",
              jobName: "signal-job",
              clusterId: "smoke-hermes-override-attribution",
              suggestedAngle: "PolicyPete: attribution override confirmed."
            }
          ]
        }
      ]
    })
  });
  assert(overrideImport.importedSignalIds.length === 1, "signal-level attribution override import should create a signal");
  const overrideSignals = await api("/api/signals?includeDismissed=true&limit=200");
  const overrideSignal = overrideSignals.find((signal) => signal.topic === "Hermes Override Attribution Signal");
  assert(overrideSignal.hermesProvider === "signal-provider", "signal-level provider attribution should override top-level attribution");
  assert(overrideSignal.hermesModel === "signal-model", "signal-level model attribution should override top-level attribution");
  assert(overrideSignal.hermesEndpoint === "http://signal-endpoint/v1", "signal-level endpoint attribution should override top-level attribution");
  assert(overrideSignal.hermesJobName === "signal-job", "signal-level job name attribution should override top-level attribution");

  const validationImport = await api("/api/hermes/import", {
    method: "POST",
    body: JSON.stringify({
      runType: "validation_ping",
      jobName: "smoke-validation-job",
      provider: "lmstudio",
      model: "qwen3.6-35b-a3b-mtp",
      endpoint: "http://localhost:1234/v1",
      generatedAt: new Date().toISOString(),
      validationId: "smoke-validation-id",
      personas: [
        {
          personaId: "policy-pete",
          signals: [
            {
              topic: "Hermes Validation Signal",
              source: "Hermes",
              suggestedAngle: "PolicyPete: validation round trip confirmed."
            }
          ]
        }
      ]
    })
  });
  assert(validationImport.importedSignalIds.length === 1, "validation_ping import should create a validation signal");

  const validationSignals = await api("/api/signals?status=new&includeDismissed=true&limit=100");
  const validationSignal = validationSignals.find((signal) => signal.validationId === "smoke-validation-id");
  assert(validationSignal.topic === "Hermes Validation Signal", "validation signal should be persisted");
  assert(validationSignal.hermesProvider === "lmstudio", "validation provider attribution should persist");
  assert(validationSignal.hermesModel === "qwen3.6-35b-a3b-mtp", "validation model attribution should persist");
  assert(validationSignal.hermesEndpoint === "http://localhost:1234/v1", "validation endpoint attribution should persist");
  assert(validationSignal.hermesJobName === "smoke-validation-job", "validation job name attribution should persist");

  const validationResult = await api("/api/hermes/validate", {
    method: "POST",
    body: JSON.stringify({
      provider: "lmstudio",
      model: "qwen3.6-35b-a3b-mtp",
      endpoint: "http://localhost:1234/v1",
      validationId: "in-process-validation-id"
    })
  });
  assert(validationResult.exportReachable === true, "validate route should reach export");
  assert(validationResult.importReachable === true, "validate route should reach import");
  assert(validationResult.validationSignalCreated === true, "validate route should create a validation signal");

  const mockRejectedDigest = await api("/api/hermes/morning-digest/run", {
    method: "POST",
    body: JSON.stringify({
      providers: ["mock"],
      timeoutMs: 1,
      maxSignalsPerPersona: 1,
      jobName: "smoke-mock-rejected-digest"
    })
  });
  assert(!mockRejectedDigest.providerNames.includes("mock"), "morning digest route should exclude mock provider unless explicitly allowed");

  await api(`/api/personas/${personas[0].id}`, {
    method: "PATCH",
    body: JSON.stringify({ platformStatus: "active" })
  });
  await api(`/api/personas/${personas[1].id}`, {
    method: "PATCH",
    body: JSON.stringify({ platformStatus: "draft" })
  });

  const providerDigest = await api("/api/hermes/morning-digest/run", {
    method: "POST",
    body: JSON.stringify({
      providers: ["mock"],
      allowMock: true,
      maxSignalsPerPersona: 2,
      provider: "lmstudio",
      model: "qwen3.6-35b-a3b-mtp",
      endpoint: "http://localhost:1234/v1",
      jobName: "smoke-provider-morning-digest"
    })
  });
  assert(providerDigest.runId, "provider-backed morning digest should return a run id");
  assert(providerDigest.candidateCount > 0, "provider-backed morning digest should collect candidates");
  assert(providerDigest.mockFilteredCount === 0, "explicitly allowed mock digest should not filter mock fixtures");
  assert(providerDigest.missingDateFilteredCount === 0, "provider-backed morning digest fixtures should include dates");
  assert(providerDigest.freshCandidateCount > 0, "provider-backed morning digest should report fresh candidate count");
  assert(providerDigest.signalCount > 0, "provider-backed morning digest should create scored signals");
  assert(providerDigest.providerNames.includes("mock"), "provider-backed morning digest should report provider names");
  assert(providerDigest.topSignalsByPersona.every((persona) => persona.signalCount <= 2), "provider-backed morning digest should respect maxSignalsPerPersona");
  assert(providerDigest.attribution.provider === "lmstudio", "provider-backed morning digest should include attribution");
  assert(providerDigest.skippedPersonaIds.includes(personas[1].id), "provider-backed morning digest should skip draft personas");
  assert(!providerDigest.topSignalsByPersona.some((persona) => persona.personaId === personas[1].id), "skipped personas should not appear in digest selections");
  const entities = personas.find(p => p.id === personas[0].id)?.trackedEntities || [];
  const digestStr = JSON.stringify(providerDigest.topSignalsByPersona);
  const entityVals = entities.flatMap(e => [e.entity_name, e.primary_x_handle]).filter(Boolean);
  const hasEntityContent = entityVals.length > 0 && entityVals.some(v => digestStr.includes(v));
  assert(hasEntityContent, "provider-backed morning digest should use Watch List entities, not persona_queries");
  assert(!digestStr.includes("federal budget reconciliation"), "provider-backed morning digest should NOT use legacy persona_queries");

  const afterDeleteQueryPersona = await api(`/api/personas/${personas[0].id}/queries/${addedQuery.id}`, { method: "DELETE" });
  assert(!afterDeleteQueryPersona.queries.some((query) => query.id === addedQuery.id), "persona query delete should remove query from backend");

  const latestProviderDigest = await api("/api/hermes/morning-digest/latest");
  assert(latestProviderDigest.status === "completed", "latest provider-backed digest should report completed status");
  assert(latestProviderDigest.providerNames.includes("mock"), "latest provider-backed digest should include provider names");
  assert(latestProviderDigest.freshCandidateCount === providerDigest.freshCandidateCount, "latest provider-backed digest should include freshness counts");
  assert(latestProviderDigest.signalCount === providerDigest.signalCount, "latest provider-backed digest should report signal count");
  assert(latestProviderDigest.attribution.jobName === "smoke-provider-morning-digest", "latest provider-backed digest should preserve attribution");
  const compactProviderDigest = await api("/api/hermes/morning-digest/latest?compact=true");
  assert(!JSON.stringify(compactProviderDigest).includes("rawCluster"), "compact latest digest should omit rawCluster payloads");
  assert(!JSON.stringify(compactProviderDigest).includes("rawData"), "compact latest digest should omit rawData payloads");
  assert(compactProviderDigest.topSignalsByPersona[0].signals[0].publishedAt, "compact latest digest should include publishedAt");

  const providerDigestSignals = await api("/api/signals?includeDismissed=true&limit=200");
  const createdProviderSignals = providerDigest.importedSignalIds
    .map((id) => providerDigestSignals.find((signal) => signal.id === id))
    .filter(Boolean);
  assert(createdProviderSignals.length === providerDigest.importedSignalIds.length, "provider-backed digest signals should be queryable");
  assert(createdProviderSignals.every((signal) => signal.generatedBy === "Hermes"), "provider-backed digest signals should be generated by Hermes");
  assert(createdProviderSignals.every((signal) => signal.sourceProvider === "Hermes"), "provider-backed digest signals should use Hermes source provider");
  assert(createdProviderSignals.every((signal) => signal.hermesRunType === "morning_digest"), "provider-backed digest signals should be morning_digest");
  assert(createdProviderSignals.every((signal) => signal.hermesProvider === "lmstudio"), "provider-backed digest signals should persist provider attribution");
  assert(createdProviderSignals.every((signal) => signal.priorityScore > 0 && signal.freshnessScore >= 0), "provider-backed digest signals should retain scores");

  const digestScriptFailure = await runNodeScript("scripts/run-provider-morning-digest.js", {
    PCC_BASE_URL: "http://127.0.0.1:1"
  });
  assert(digestScriptFailure.code === 1, "provider digest script should fail clearly when backend is unavailable");
  assert(digestScriptFailure.output.includes("FAIL provider-backed Hermes morning digest"), "provider digest script should print a clear failure");

  const qualityFixturePort = 3298;
  const qualityFixture = spawn(process.execPath, ["-e", `
    const { createServer } = await import("node:http");
    createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        status: "completed",
        providerNames: ["mock"],
        signalCount: 1,
        freshCandidateCount: 1,
        topSignalsByPersona: [{
          personaId: "policy-pete",
          summary: "bad fixture",
          signalCount: 1,
          signals: [{
            topic: "2025 archive story",
            source: "mock-public-news.example",
            publishedAt: "2025-01-01T00:00:00.000Z",
            priorityScore: 80,
            evidenceUrls: ["https://mock-public-news.example/story"],
            hermesProvider: "fixture",
            hermesModel: "fixture",
            hermesJobName: "fixture"
          }]
        }]
      }));
    }).listen(${qualityFixturePort}, "127.0.0.1");
  `], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const qualityScriptFailure = await runNodeScript("scripts/verify-digest-quality.js", {
    PCC_BASE_URL: `http://127.0.0.1:${qualityFixturePort}`
  });
  qualityFixture.kill("SIGTERM");
  assert(qualityScriptFailure.code === 1, "digest quality script should fail stale/mock compact records");
  assert(qualityScriptFailure.output.includes("FAIL digest quality verification"), "digest quality script should print a clear failure");

  const hermesHealth = await api("/api/hermes/health");
  assert(hermesHealth.lastValidationStatus === "completed", "Hermes health should report validation status");
  assert(hermesHealth.lastProvider === "lmstudio", "Hermes health should report provider");
  assert(hermesHealth.lastModel === "qwen3.6-35b-a3b-mtp", "Hermes health should report model");
  assert(hermesHealth.lastEndpoint === "http://localhost:1234/v1", "Hermes health should report endpoint");

  const hermesSignals = await api("/api/signals?personaId=the-wonkette&includeDismissed=true&limit=20");
  const hermesSignal = hermesSignals.find((signal) => signal.generatedBy === "Hermes" && signal.hermesRunType === "morning_digest");
  assert(hermesSignal, "Hermes import should create Hermes-generated signals");
  assert(hermesSignal.hermesRunType === "morning_digest", "Hermes signals should retain run type");

  const history = await api(`/api/signals/${hermesSignal.id}/history`);
  assert(history.snapshots.length >= 2, "duplicate Hermes import should create score history snapshots");
  assert(history.snapshots.every((snapshot) => snapshot.priorityScore >= 0), "score history should include priority");

  const velocityClusterId = `smoke-velocity-${Date.now()}`;
  for (const [index, sourceCount] of [2, 14].entries()) {
    await api("/api/hermes/import", {
      method: "POST",
      body: JSON.stringify({
        version: "2026-06-phase4f",
        runType: index === 0 ? "midday_brief" : "velocity_scan",
        provider: "lmstudio",
        model: "qwen3.6-35b-a3b-mtp",
        endpoint: "http://localhost:1234/v1",
        jobName: "smoke-velocity-job",
        generatedAt: new Date().toISOString(),
        personas: [{
          personaId: hermesSignal.personaId,
          signals: [{
            topic: "Smoke Velocity Alert Signal",
            source: "Hermes",
            query: "smoke velocity",
            velocityScore: 45 + index * 40,
            relevanceScore: 80,
            noveltyScore: 70,
            freshnessScore: 90,
            priorityScore: 60 + index * 28,
            riskScore: 10,
            sourceCount,
            clusterId: velocityClusterId,
            suggestedAngle: "Smoke velocity alert verification."
          }]
        }]
      })
    });
  }

  const velocityAlerts = await api("/api/velocity-alerts");
  assert(velocityAlerts.some((alert) => alert.accelerationScore >= 60), "velocity alerts endpoint should include generated alerts");
  const velocityLatest = await api("/api/velocity/latest");
  assert(velocityLatest.snapshotsEvaluated > 0, "velocity latest endpoint should report evaluated snapshots");
  assert(velocityLatest.alertsGenerated >= 1, "velocity latest endpoint should report generated alerts");

  await api(`/api/signals/${hermesSignal.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "new", lastSeenAt: "2000-01-01T00:00:00.000Z" })
  });
  const archived = await api("/api/signals/archive", {
    method: "POST",
    body: JSON.stringify({ days: 7 })
  });
  assert(archived.archived >= 1, "archive endpoint should archive old signals");

  const runs = await api("/api/ingestion/runs");
  const mockRun = runs.find((run) => run.runType === "mock");
  assert(mockRun.signalsCreated === 12, "ingestion history should record signals created");
  assert(mockRun.candidateCount >= 12, "ingestion history should record candidates");

  const todaySignals = await api("/api/signals/today");
  assert(todaySignals.length >= 12, "expected today's signals to include mock ingestion output");
  assert(todaySignals[0].priorityScore >= todaySignals[todaySignals.length - 1].priorityScore, "today signals should sort by priority");

  const explorerSignals = await api("/api/signals?sort=priority&limit=10&includeDismissed=true");
  assert(explorerSignals.length === 10, "signal explorer endpoint should return limited signals");

  const reviewedSignal = await api(`/api/signals/${todaySignals[0].id}/mark-reviewed`, { method: "POST" });
  assert(reviewedSignal.status === "reviewed", "signal mark-reviewed should update status");

  const dismissedSignal = await api(`/api/signals/${todaySignals[1].id}/dismiss`, { method: "POST" });
  assert(dismissedSignal.status === "dismissed", "signal dismiss should update status");

  const visibleSignalsAfterDismiss = await api("/api/signals/today");
  assert(!visibleSignalsAfterDismiss.some((signal) => signal.id === dismissedSignal.id), "dismissed signal should leave today view");

  const drafts = await api("/api/drafts/generate", {
    method: "POST",
    body: JSON.stringify({
      personaId: reviewedSignal.personaId,
      signalIds: [reviewedSignal.id],
      count: 3
    })
  });
  assert(drafts.length === 3, "expected draft generation to create three drafts");
  assert(drafts.every((draft) => draft.status === "needs_review"), "expected generated drafts to need review");
  assert(drafts.every((draft) => draft.sourceSignalIds.includes(reviewedSignal.id)), "drafts should link selected signal");

  const edited = await api(`/api/drafts/${drafts[0].id}`, {
    method: "PATCH",
    body: JSON.stringify({ editedBody: "Edited smoke-test draft body" })
  });
  assert(edited.editedBody === "Edited smoke-test draft body", "draft edit should persist");

  const approved = await api(`/api/drafts/${drafts[0].id}/approve`, { method: "POST" });
  assert(approved.status === "approved", "draft approve should update status");

  const rejected = await api(`/api/drafts/${drafts[1].id}/reject`, { method: "POST" });
  assert(rejected.status === "rejected", "draft reject should update status");

  const regenerated = await api(`/api/drafts/${drafts[2].id}/regenerate`, { method: "POST" });
  assert(regenerated.status === "needs_review", "draft regenerate should return to review");
  assert(regenerated.editedBody !== drafts[2].editedBody, "draft regenerate should change edited body");

  const scheduled = await api("/api/schedule", {
    method: "POST",
    body: JSON.stringify({ draftId: approved.id })
  });
  assert(scheduled.status === "scheduled", "expected schedule endpoint to create a scheduled post");

  const rescheduled = await api(`/api/schedule/${scheduled.id}`, {
    method: "PATCH",
    body: JSON.stringify({ scheduledAt: "2030-01-01T15:00:00.000Z" })
  });
  assert(rescheduled.scheduledAt === "2030-01-01T15:00:00.000Z", "schedule edit should persist");

  const cancelled = await api(`/api/schedule/${scheduled.id}/cancel`, { method: "POST" });
  assert(cancelled.status === "cancelled", "scheduled post cancel should update status");

  const schedule = await api("/api/schedule");
  assert(schedule.length === 1, "expected one scheduled post");

  const auditLog = await api("/api/audit-log?limit=100");
  const actions = auditLog.map((entry) => entry.action);
  assert(actions.includes("ingestion.completed"), "audit log should include ingestion completion");
  assert(actions.includes("signal.dismissed"), "audit log should include signal dismissal");
  assert(actions.includes("draft.generated"), "audit log should include draft generation");
  assert(actions.includes("draft.edited"), "audit log should include draft edit");
  assert(actions.includes("draft.approved"), "audit log should include draft approval");
  assert(actions.includes("draft.rejected"), "audit log should include draft rejection");
  assert(actions.includes("post.scheduled"), "audit log should include scheduling");
  assert(actions.includes("scheduled_post.cancelled"), "audit log should include schedule cancellation");
  assert(actions.includes("persona.updated"), "audit log should include persona update");
  assert(actions.includes("persona_query.created"), "audit log should include persona query creation");
  assert(actions.includes("persona_query.updated"), "audit log should include persona query update");
  assert(actions.includes("persona_query.toggled"), "audit log should include persona query toggle");
  assert(actions.includes("persona_query.deleted"), "audit log should include persona query delete");
  const personaAudit = auditLog.find((entry) => entry.action === "persona.updated" && entry.metadata?.personaId === personas[0].id);
  const queryAudit = auditLog.find((entry) => entry.action === "persona_query.created" && entry.metadata?.personaId === personas[0].id);
  assert(personaAudit?.metadata?.personaId === personas[0].id, "persona audit metadata should include personaId");
  assert(queryAudit?.metadata?.personaId === personas[0].id && queryAudit?.metadata?.queryId, "query audit metadata should include personaId and queryId");
  assert(actions.includes("hermes.import.completed"), "audit log should include Hermes import");
  assert(actions.includes("signals.archived"), "audit log should include signal archiving");
  assert(actions.includes("hermes.settings.updated"), "audit log should include Hermes settings update");
  assert(actions.includes("hermes_export_requested"), "audit log should include Hermes export");
  assert(actions.includes("hermes_validation_started"), "audit log should include validation start");
  assert(actions.includes("hermes_validation_imported"), "audit log should include validation import");

  console.log("Smoke test passed");
} finally {
  server.kill("SIGTERM");
}
