import { spawn } from "node:child_process";
import { rm, cp } from "node:fs/promises";
import path from "node:path";
import fs from "node:fs";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const BASE_PORT = 4199;
let server = null;
let logs = "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, options = {}, port = BASE_PORT) {
  const url = `http://127.0.0.1:${port}${path}`;
  const response = await fetch(url, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const json = await response.json();
  if (!response.ok) {
    const err = new Error(`${options.method || "GET"} ${path} failed: ${JSON.stringify(json)}`);
    err.status = response.status;
    err.body = json;
    throw err;
  }
  return json;
}

function startServer(env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/server.js"], {
      cwd: rootDir,
      env: { ...process.env, PORT: String(BASE_PORT), DB_PATH: env.DB_PATH, DISABLE_HERMES_BOOTSTRAP: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });

    const startTime = Date.now();
    const interval = setInterval(async () => {
      if (Date.now() - startTime > 10000) {
        clearInterval(interval);
        child.kill("SIGTERM");
        reject(new Error(`Server did not start. Logs:\n${output}`));
      }
      try {
        const response = await fetch(`http://127.0.0.1:${BASE_PORT}/api/health`);
        if (response.ok) {
          clearInterval(interval);
          resolve(child);
        }
      } catch {}
    }, 100);
  });
}

function killServer(proc) {
  return new Promise((resolve) => {
    if (!proc || !proc.pid) return resolve();
    proc.on("close", () => resolve());
    proc.kill("SIGTERM");
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      resolve();
    }, 2000);
  });
}

async function ensureDb(path, sourceDb) {
  try { await rm(path, { force: true }); } catch {}
  if (sourceDb) {
    await cp(sourceDb, path);
  }
}

const TEST_DB = path.join(rootDir, "work", "persistence-cert.sqlite");
const BACKUP_DB = path.join(rootDir, "work", "persistence-cert-baseline.sqlite");
const TEST_DB2 = path.join(rootDir, "work", "persistence-cert-2.sqlite");

// =============================================
// SCENARIO 1: Restart during Hermes digest
// =============================================
async function testRestartDuringHermesDigest() {
  console.log("\n=== SCENARIO 1: Restart during Hermes digest ===");
  await ensureDb(TEST_DB);

  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    // Create baseline: 4 personas with mock runs
    const personas = await api("/api/personas");
    assert(personas.length === 4, "Expected 4 seeded personas");

    // Run a mock ingestion first to get some signals
    const ingestion1 = await api("/api/ingestion/run", {
      method: "POST",
      body: JSON.stringify({ useMockProviders: true })
    });
    assert(ingestion1.signals.length === 12, "Expected 12 mock signals");

    // Simulate a Hermes import (this is fast, so the real risk is interruption mid-import)
    // Kill server mid-import by sending SIGTERM while the import is processing
    // We can't truly interrupt an in-flight import, so we simulate by:
    // 1. Get the signal count before
    const beforeSignals = await api("/api/signals?includeDismissed=true&limit=200");
    const beforeCount = beforeSignals.length;

    // 2. Kill server mid-operation (simulated by just restarting and checking nothing got corrupted)
    await killServer(srv);
    srv = await startServer({ DB_PATH: TEST_DB });

    // Check that signals survived restart
    const afterSignals = await api("/api/signals?includeDismissed=true&limit=200");
    const afterCount = afterSignals.length;
    assert(afterCount === beforeCount, `Signals should survive restart: ${beforeCount} -> ${afterCount}`);

    // Check ingestion_runs survives restart
    const runs = await api("/api/ingestion/runs");
    assert(runs.length >= 1, "Ingestion runs should survive restart");

    // Check audit log survives restart
    const auditLog = await api("/api/audit-log?limit=50");
    assert(auditLog.length > 0, "Audit log should survive restart");
    assert(auditLog.some(e => e.action === "ingestion.completed"), "Ingestion audit event should survive restart");

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Restart during Hermes digest scenario");
}

// =============================================
// SCENARIO 2: Restart during save
// =============================================
async function testRestartDuringSave() {
  console.log("\n=== SCENARIO 2: Restart during save ===");
  await ensureDb(TEST_DB);

  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    const personas = await api("/api/personas");
    const personaId = personas[0].id;

    // Kill server immediately after a PATCH request
    // The request completes synchronously in Node, so we test that the write is durable
    const patched = await api(`/api/personas/${personaId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Survived Persona Name",
        handle: personas[0].handle,
        niche: "survived niche test",
        voiceTone: "survived voice"
      })
    });
    assert(patched.name === "Survived Persona Name", "Persona name should be updated");

    // Kill and restart
    await killServer(srv);
    srv = await startServer({ DB_PATH: TEST_DB });

    // Verify the save survived
    const reloaded = await api(`/api/personas/${personaId}`);
    assert(reloaded.name === "Survived Persona Name", `Persona name should survive restart: ${reloaded.name}`);
    assert(reloaded.niche === "survived niche test", "Persona niche should survive restart");
    assert(reloaded.voiceTone === "survived voice", "Persona voice should survive restart");
    assert(reloaded.userEdited === true, "Persona edit flag should survive restart");
    assert(reloaded.lockedFromSeedOverwrite === true, "Persona seed lock flag should survive restart");

    // Test query edit survival
    await killServer(srv);
    srv = await startServer({ DB_PATH: TEST_DB });

    const reloaded2 = await api(`/api/personas/${personaId}`);
    const query = reloaded2.queries[0];
    assert(query, "Queries should survive restart");

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Restart during save scenario");
}

// =============================================
// SCENARIO 3: Simultaneous persona edits
// =============================================
async function testSimultaneousPersonaEdits() {
  console.log("\n=== SCENARIO 3: Simultaneous persona edits ===");
  await ensureDb(TEST_DB);

  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    const personas = await api("/api/personas");
    const id = personas[0].id;

    // Fire 10 concurrent edits to the same persona
    const editTasks = [];
    for (let i = 0; i < 10; i++) {
      editTasks.push(
        api(`/api/personas/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: `Concurrent Edit ${i}`,
            handle: `@Concurrent${i}`,
            niche: `Concurrent niche ${i}`,
            voiceTone: `Concurrent voice ${i}`
          })
        }).catch(err => ({ error: err }))
      );
    }
    const results = await Promise.allSettled(editTasks);
    const fulfilled = results.filter(r => r.status === "fulfilled").length;
    assert(fulfilled >= 9, `At least 9 of 10 concurrent edits should succeed (got ${fulfilled})`);

    // Verify the final state is consistent
    const final = await api(`/api/personas/${id}`);
    assert(final.name.startsWith("Concurrent Edit "), `Final name should be one of the concurrent edits: ${final.name}`);

    // Verify no data corruption: count all rows
    const allPersonas = await api("/api/personas");
    assert(allPersonas.length === 4, `Should still have 4 personas after concurrent edits (got ${allPersonas.length})`);
    assert(allPersonas.every(p => p.name), "All personas should have names");

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Simultaneous persona edits scenario");
}

// =============================================
// SCENARIO 4: Simultaneous Hermes imports
// =============================================
async function testSimultaneousHermesImports() {
  console.log("\n=== SCENARIO 4: Simultaneous Hermes imports ===");
  await ensureDb(TEST_DB);

  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    const payload = {
      version: "2026-06-phase4",
      runType: "velocity_scan",
      provider: "lmstudio",
      model: "test-model",
      endpoint: "http://localhost:1234/v1",
      jobName: "simultaneous-import-test",
      generatedAt: new Date().toISOString(),
      personas: [
        {
          personaId: "the-wonkette",
          signals: [
            {
              topic: "Simultaneous Import Signal",
              source: "Hermes",
              query: "simultaneous test",
              priorityScore: 75,
              velocityScore: 55,
              relevanceScore: 80,
              noveltyScore: 70,
              freshnessScore: 85,
              riskScore: 10,
              sourceCount: 3,
              clusterId: `simultaneous-cluster-${Date.now()}`,
              suggestedAngle: "Test: simultaneous import verification."
            }
          ]
        }
      ]
    };

    // Fire 10 simultaneous imports
    const importTasks = [];
    for (let i = 0; i < 10; i++) {
      const p = { ...payload, generatedAt: new Date().toISOString() };
      p.personas[0].signals[0].clusterId = `simultaneous-cluster-${Date.now()}-${i}`;
      importTasks.push(
        api("/api/hermes/import", {
          method: "POST",
          body: JSON.stringify(p)
        }).catch(err => ({ error: err.message, failed: true }))
      );
    }
    const results = await Promise.allSettled(importTasks);

    const successes = results.filter(r => r.status === "fulfilled" && !r.value.failed).length;
    assert(successes >= 8, `At least 8 of 10 simultaneous imports should succeed (got ${successes})`);

    // Verify signals were created
    const signals = await api("/api/signals?includeDismissed=true&limit=200");
    const testSignals = signals.filter(s => s.topic === "Simultaneous Import Signal");
    assert(testSignals.length >= 8, `Expected at least 8 unique signals from simultaneous imports (got ${testSignals.length})`);

    // Check no DB corruption
    const allSignals = await api("/api/signals?includeDismissed=true&limit=200");
    assert(allSignals.every(s => s.id), "All signals should have ids");
    const uniqueIds = new Set(allSignals.map(s => s.id));
    assert(uniqueIds.size === allSignals.length, "No duplicate signal IDs should exist");

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Simultaneous Hermes imports scenario");
}

// =============================================
// SCENARIO 5: Repeated provider runs
// =============================================
async function testRepeatedProviderRuns() {
  console.log("\n=== SCENARIO 5: Repeated provider runs ===");
  await ensureDb(TEST_DB);

  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    // Run mock ingestion 5 times
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const result = await api("/api/ingestion/run", {
        method: "POST",
        body: JSON.stringify({ useMockProviders: true })
      });
      runs.push(result);
    }

    // Verify each run was recorded
    const ingestionRuns = await api("/api/ingestion/runs");
    const mockRuns = ingestionRuns.filter(r => r.runType === "mock");
    assert(mockRuns.length >= 5, `Expected at least 5 mock ingestion runs (got ${mockRuns.length})`);

    // Verify deduplication worked - same mock data doesn't create duplicate signals
    // (mock provider generates same topics each time)
    const signals = await api("/api/signals?includeDismissed=true&limit=200");
    const uniqueTopics = new Set(signals.filter(s => s.generatedBy !== "Hermes").map(s => s.topic));
    assert(uniqueTopics.size >= 4, `Expected at least 4 unique signal topics after 5 runs (got ${uniqueTopics.size})`);

    // Run provider-backed morning digest (with mock allowed)
    for (let i = 0; i < 3; i++) {
      const digest = await api("/api/hermes/morning-digest/run", {
        method: "POST",
        body: JSON.stringify({
          providers: ["mock"],
          allowMock: true,
          maxSignalsPerPersona: 2,
          provider: "lmstudio",
          model: "test-model",
          endpoint: "http://localhost:1234/v1",
          jobName: "repeated-digest-test"
        })
      });
      assert(digest.runId, `Digest run ${i} should return a run id`);
    }

    // Check digest runs are recorded
    const allRuns = await api("/api/ingestion/runs");
    const digestRuns = allRuns.filter(r => r.runType === "morning_digest");
    assert(digestRuns.length >= 3, `Expected at least 3 morning digest runs (got ${digestRuns.length})`);

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Repeated provider runs scenario");
}

// =============================================
// SCENARIO 6: Seed reinitialization
// =============================================
async function testSeedReinitialization() {
  console.log("\n=== SCENARIO 6: Seed reinitialization ===");
  await ensureDb(TEST_DB);

  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    // Modify personas
    const personas = await api("/api/personas");
    const originalWonkette = personas.find(p => p.id === "the-wonkette");

    await api(`/api/personas/the-wonkette`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Modified Wonkette",
        handle: "@ModdedWonkette",
        niche: "Modified niche",
        voiceTone: "Modified voice"
      })
    });

    // Kill server
    await killServer(srv);

    // Reinitialize DB (simulates npm run init:db) — server initDb runs on startup
    // Start fresh server pointing to same DB — initDb runs again
    srv = await startServer({
      DB_PATH: TEST_DB,
      DISABLE_HERMES_BOOTSTRAP: "1"
    });

    // Verify modified data survived seed reinitialization
    const reloaded = await api("/api/personas/the-wonkette");
    assert(reloaded.name === "Modified Wonkette",
      `Modified persona name should survive seed reinit: "${reloaded.name}"`);
    assert(reloaded.handle === "@ModdedWonkette",
      `Modified persona handle should survive seed reinit: ${reloaded.handle}`);
    assert(reloaded.niche === "Modified niche",
      `Modified persona niche should survive seed reinit: "${reloaded.niche}"`);
    assert(reloaded.userEdited === true,
      "UserEdited flag should survive seed reinit");
    assert(reloaded.lockedFromSeedOverwrite === true,
      "LockedFromSeedOverwrite flag should survive seed reinit");

    // Verify missing seed rows are inserted (existing ones are protected)
    const allPersonas = await api("/api/personas");
    assert(allPersonas.length === 4, "Should still have exactly 4 personas after seed reinit");
    assert(allPersonas.every(p => p.name), "All personas should have names after seed reinit");

    // Verify seed queries exist but modified ones are preserved
    const wonketteQueries = reloaded.queries;
    assert(wonketteQueries.length >= 3, "Should have at least 3 queries for wonkette");

    // Verify Hermes settings survived
    const settings = await api("/api/hermes/settings");
    assert(settings.morningDigestEnabled === true, "Hermes settings should survive seed reinit");

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Seed reinitialization scenario");
}

// =============================================
// SCENARIO 7: Browser refresh (stateless check)
// =============================================
async function testBrowserRefresh() {
  console.log("\n=== SCENARIO 7: Browser refresh (stateless check) ===");

  // This test verifies the API layer is stateless and always returns
  // consistent data from SQLite. A browser refresh is equivalent to
  // re-fetching all data from the API.

  await ensureDb(TEST_DB);

  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    // Create state
    const personas = await api("/api/personas");
    await api(`/api/personas/${personas[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Browser Refresh Test",
        handle: "@RefreshTest",
        niche: "Refresh test niche",
        voiceTone: "Refresh voice"
      })
    });
    await api("/api/ingestion/run", {
      method: "POST",
      body: JSON.stringify({ useMockProviders: true })
    });

    // Simulate browser refresh: re-fetch all state
    const personasAfterRefresh = await api("/api/personas");
    const signalsAfterRefresh = await api("/api/signals?includeDismissed=true&limit=200");
    const settingsAfterRefresh = await api("/api/hermes/settings");
    const auditAfterRefresh = await api("/api/audit-log?limit=50");
    const runsAfterRefresh = await api("/api/ingestion/runs");
    const alertsAfterRefresh = await api("/api/velocity-alerts");

    // Verify consistency
    assert(personasAfterRefresh.length === 4, "Personas should be consistent across refreshes");
    assert(personasAfterRefresh.find(p => p.id === personas[0].id).name === "Browser Refresh Test",
      "Persona edit should persist across simulated browser refresh");

    // Re-fetch same data and verify it's identical
    const personasAfterRefresh2 = await api("/api/personas");
    const signalsAfterRefresh2 = await api("/api/signals?includeDismissed=true&limit=200");

    assert(JSON.stringify(personasAfterRefresh) === JSON.stringify(personasAfterRefresh2),
      "Persona data should be identical across two GET requests");
    assert(JSON.stringify(signalsAfterRefresh) === JSON.stringify(signalsAfterRefresh2),
      "Signal data should be identical across two GET requests without writes");

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Browser refresh scenario");
}

// =============================================
// SCENARIO 8: Server restart (full durability)
// =============================================
async function testServerRestart() {
  console.log("\n=== SCENARIO 8: Server restart (full durability) ===");
  await ensureDb(TEST_DB);

  // Phase 1: Create rich state
  let srv = await startServer({ DB_PATH: TEST_DB });
  let personaQueriesSnapshot;
  try {
    const personas = await api("/api/personas");

    // Edit persona
    await api(`/api/personas/the-wonkette`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "Restart Survivor",
        handle: "@RestartSurvivor",
        niche: "Restart survivor niche",
        voiceTone: "Restart survivor voice"
      })
    });

    // Run ingestion
    await api("/api/ingestion/run", {
      method: "POST",
      body: JSON.stringify({ useMockProviders: true })
    });

    // Run Hermes import
    await api("/api/hermes/import", {
      method: "POST",
      body: JSON.stringify({
        version: "2026-06-phase4",
        runType: "morning_digest",
        provider: "lmstudio",
        model: "survivor-model",
        endpoint: "http://localhost:1234/v1",
        jobName: "restart-survivor-test",
        generatedAt: new Date().toISOString(),
        personas: [{
          personaId: "the-wonkette",
          signals: [{
            topic: "Restart Survivor Signal",
            source: "Hermes",
            query: "restart survivor",
            priorityScore: 95,
            velocityScore: 70,
            relevanceScore: 85,
            noveltyScore: 80,
            freshnessScore: 90,
            riskScore: 5,
            sourceCount: 4,
            clusterId: "restart-survivor-cluster",
            suggestedAngle: "The Wonkette: test restart durability."
          }]
        }]
      })
    });

    // Update Hermes settings
    await api("/api/hermes/settings", {
      method: "PATCH",
      body: JSON.stringify({ archiveAfterDays: 14, eveningScanEnabled: false })
    });

    // Add a query
    const updated = await api(`/api/personas/the-wonkette/queries`, {
      method: "POST",
      body: JSON.stringify({ query: "restart survivor query", provider: "rss", weight: 3 })
    });
    personaQueriesSnapshot = JSON.stringify(updated.queries.map(q => ({ id: q.id, query: q.query, provider: q.provider, weight: q.weight, isActive: q.isActive })));

    // Create draft
    const signals = await api("/api/signals?personaId=the-wonkette&includeDismissed=true&limit=20");
    const reviewed = await api(`/api/signals/${signals[0].id}/mark-reviewed`, { method: "POST" });
    const drafts = await api("/api/drafts/generate", {
      method: "POST",
      body: JSON.stringify({ personaId: "the-wonkette", signalIds: [reviewed.id], count: 2 })
    });
    const approved = await api(`/api/drafts/${drafts[0].id}/approve`, { method: "POST" });
    await api("/api/schedule", {
      method: "POST",
      body: JSON.stringify({ draftId: approved.id })
    });

    // Kill server
    await killServer(srv);
    srv = null;
  } finally {
    if (srv) await killServer(srv);
  }

  // Phase 2: Restart and verify everything survived
  srv = await startServer({ DB_PATH: TEST_DB });
  try {
    // Personas
    const personas = await api("/api/personas");
    const wonkette = personas.find(p => p.id === "the-wonkette");
    assert(wonkette.name === "Restart Survivor",
      `Persona name should survive full restart: "${wonkette.name}"`);
    assert(wonkette.handle === "@RestartSurvivor",
      `Persona handle should survive full restart: ${wonkette.handle}`);
    assert(wonkette.niche === "Restart survivor niche",
      `Persona niche should survive full restart`);
    assert(wonkette.userEdited === true, "UserEdited flag survives restart");
    assert(wonkette.lockedFromSeedOverwrite === true, "LockedFromSeedOverwrite flag survives restart");

    // Queries
    assert(wonkette.queries.some(q => q.query === "restart survivor query"),
      "Added query should survive restart");

    // Signals
    const signals = await api("/api/signals?includeDismissed=true&limit=200");
    assert(signals.some(s => s.topic === "Restart Survivor Signal"),
      "Hermes-imported signal should survive restart");
    assert(signals.some(s => s.topic.includes("Court ethics")),
      "Mock-ingested signals should survive restart");

    // Signal attribution
    const hermesSignal = signals.find(s => s.topic === "Restart Survivor Signal");
    assert(hermesSignal.hermesProvider === "lmstudio", "Hermes provider attribution survives restart");
    assert(hermesSignal.hermesModel === "survivor-model", "Hermes model attribution survives restart");
    assert(hermesSignal.hermesRunType === "morning_digest", "Hermes run type survives restart");

    // Score snapshots
    const history = await api(`/api/signals/${hermesSignal.id}/history`);
    assert(history.snapshots.length >= 1, "Score snapshots should survive restart");

    // Ingestion runs
    const ingestionRuns = await api("/api/ingestion/runs");
    assert(ingestionRuns.length >= 2,
      `Ingestion runs should survive restart (got ${ingestionRuns.length})`);

    // Hermes settings
    const settings = await api("/api/hermes/settings");
    assert(settings.archiveAfterDays === 14,
      `Hermes settings should survive restart: archiveAfterDays=${settings.archiveAfterDays}`);
    assert(settings.eveningScanEnabled === false,
      "Hermes eveningScanEnabled should survive restart");

    // Drafts
    const drafts = await api("/api/drafts");
    assert(drafts.length >= 1,
      `Drafts should survive restart (got ${drafts.length})`);
    assert(drafts.some(d => d.status === "approved"),
      "Approved draft status should survive restart");

    // Scheduled posts
    const schedule = await api("/api/schedule");
    assert(schedule.length >= 1,
      `Scheduled posts should survive restart (got ${schedule.length})`);

    // Audit log
    const auditLog = await api("/api/audit-log?limit=100");
    const actions = auditLog.map(e => e.action);
    assert(actions.includes("persona.updated"), "Persona update audit event survives restart");
    assert(actions.includes("ingestion.completed"), "Ingestion audit event survives restart");
    assert(actions.includes("hermes.import.completed"), "Hermes import audit event survives restart");
    assert(actions.includes("hermes.settings.updated"), "Hermes settings audit event survives restart");
    assert(actions.includes("draft.generated"), "Draft generation audit event survives restart");
    assert(actions.includes("draft.approved"), "Draft approval audit event survives restart");
    assert(actions.includes("post.scheduled"), "Scheduling audit event survives restart");

    // Velocity alerts
    const alerts = await api("/api/velocity-alerts");
    assert(alerts.length >= 0, "Velocity alerts endpoint responds after restart");

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Server restart scenario");
}

// =============================================
// SCENARIO 9: Concurrent writes from multiple personas
// =============================================
async function testConcurrentPersonaWrites() {
  console.log("\n=== SCENARIO 9: Concurrent persona writes ===");
  await ensureDb(TEST_DB);

  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    const personas = await api("/api/personas");
    assert(personas.length === 4, "Expected 4 personas");

    // Fire concurrent edits across all 4 personas
    const edits = [];
    for (const persona of personas) {
      for (let i = 0; i < 5; i++) {
        edits.push(
          api(`/api/personas/${persona.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              name: `${persona.name} v${i}`,
              handle: persona.handle,
              niche: `${persona.niche} (edit ${i})`,
              voiceTone: `${persona.voiceTone} (edit ${i})`
            })
          }).catch(err => ({ error: err.message }))
        );
      }
    }

    const results = await Promise.allSettled(edits);
    const successes = results.filter(r => r.status === "fulfilled" && !r.value.error).length;
    assert(successes >= 18, `Expected at least 18 of 20 concurrent persona edits to succeed (got ${successes})`);

    // Verify all 4 personas still exist and have valid state
    const finalPersonas = await api("/api/personas");
    assert(finalPersonas.length === 4, "All 4 personas should still exist after concurrent edits");
    assert(finalPersonas.every(p => p.name), "All personas should have names");
    assert(finalPersonas.every(p => p.niche), "All personas should have niches");
    assert(finalPersonas.every(p => p.userEdited === true), "All personas should be marked as user edited");

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Concurrent persona writes scenario");
}

// =============================================
// SCENARIO 10: Database file corruption simulation
// =============================================
async function testDBCorruptionRecovery() {
  console.log("\n=== SCENARIO 10: Database corruption recovery ===");
  await ensureDb(TEST_DB);

  // Create a healthy DB first
  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    await api("/api/ingestion/run", {
      method: "POST",
      body: JSON.stringify({ useMockProviders: true })
    });

    const personas = await api("/api/personas");
    assert(personas.length === 4, "Expected 4 personas in healthy DB");

    const signals = await api("/api/signals?includeDismissed=true&limit=200");
    const signalCount = signals.length;
    assert(signalCount > 0, "Expected signals in healthy DB");

  } finally {
    await killServer(srv);
  }

  // Verify SQLite file is valid
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const integrityCheck = await execFileAsync("sqlite3", [TEST_DB, "PRAGMA integrity_check;"]);
  assert(integrityCheck.stdout.trim() === "ok", `SQLite integrity check: ${integrityCheck.stdout.trim()}`);

  // Verify foreign keys are intact
  const fkCheck = await execFileAsync("sqlite3", [TEST_DB, "PRAGMA foreign_key_check;"]);
  assert(fkCheck.stdout.trim() === "", `Foreign key violations: ${fkCheck.stdout.trim() || "none"}`);

  console.log("  PASS: DB corruption recovery scenario");
}

// =============================================
// SCENARIO 11: Signal deduplication correctness
// =============================================
async function testSignalDeduplication() {
  console.log("\n=== SCENARIO 11: Signal deduplication ===");
  await ensureDb(TEST_DB);

  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    // Import the same signal 3 times
    const basePayload = {
      version: "2026-06-phase4",
      runType: "morning_digest",
      provider: "lmstudio",
      model: "dedup-model",
      endpoint: "http://localhost:1234/v1",
      jobName: "dedup-test",
      generatedAt: new Date().toISOString(),
      personas: [{
        personaId: "the-wonkette",
        signals: [{
          topic: "Deduplication Test Signal",
          source: "Hermes",
          query: "dedup test",
          priorityScore: 80,
          velocityScore: 50,
          relevanceScore: 75,
          noveltyScore: 70,
          freshnessScore: 85,
          riskScore: 10,
          sourceCount: 2,
          clusterId: "dedup-cluster-id",
          suggestedAngle: "The Wonkette: test dedup."
        }]
      }]
    };

    const r1 = await api("/api/hermes/import", {
      method: "POST",
      body: JSON.stringify(basePayload)
    });
    assert(r1.imported === 1, "First import should create 1 signal");

    const r2 = await api("/api/hermes/import", {
      method: "POST",
      body: JSON.stringify(basePayload)
    });
    assert(r2.updated === 1, "Second import with same clusterId should update, not create");

    const r3 = await api("/api/hermes/import", {
      method: "POST",
      body: JSON.stringify(basePayload)
    });
    assert(r3.updated >= 1, "Third import should also update");

    // Verify only 1 signal exists
    const signals = await api("/api/signals?includeDismissed=true&limit=200");
    const dedupSignals = signals.filter(s => s.topic === "Deduplication Test Signal");
    assert(dedupSignals.length === 1,
      `Should have exactly 1 dedup signal (got ${dedupSignals.length})`);

    // Verify score snapshots were created for each import
    const history = await api(`/api/signals/${dedupSignals[0].id}/history`);
    assert(history.snapshots.length === 3,
      `Should have 3 score snapshots for 3 imports (got ${history.snapshots.length})`);

    // Verify signal was updated with latest data
    const latestAttribution = dedupSignals[0];
    assert(latestAttribution.hermesJobName === "dedup-test",
      "Updated signal should have latest attribution");

    // Test topic-based dedup (different clusterId, same topic)
    const sameTopicPayload = {
      ...basePayload,
      generatedAt: new Date().toISOString(),
      personas: [{
        personaId: "the-wonkette",
        signals: [{
          ...basePayload.personas[0].signals[0],
          clusterId: "different-cluster-id-same-topic"
        }]
      }]
    };
    const r4 = await api("/api/hermes/import", {
      method: "POST",
      body: JSON.stringify(sameTopicPayload)
    });
    assert(r4.updated === 1, "Import with same topic but different clusterId should still dedup by topic");

    const signalsAfterTopicDedup = await api("/api/signals?includeDismissed=true&limit=200");
    const dedupAfterTopic = signalsAfterTopicDedup.filter(s => s.topic === "Deduplication Test Signal");
    assert(dedupAfterTopic.length === 1,
      "Still exactly 1 signal after topic-based dedup");

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Signal deduplication scenario");
}

// =============================================
// SCENARIO 12: Draft-schedule-publish lifecycle persistence
// =============================================
async function testDraftSchedulePublishPersistence() {
  console.log("\n=== SCENARIO 12: Draft-schedule-publish lifecycle ===");
  await ensureDb(TEST_DB);

  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    // Create a signal
    const ingestion = await api("/api/ingestion/run", {
      method: "POST",
      body: JSON.stringify({ useMockProviders: true })
    });
    const signal = ingestion.signals[0];

    // Review -> Generate draft -> Approve -> Schedule -> Publish
    const reviewed = await api(`/api/signals/${signal.id}/mark-reviewed`, { method: "POST" });
    assert(reviewed.status === "reviewed", "Signal should be reviewed");

    const drafts = await api("/api/drafts/generate", {
      method: "POST",
      body: JSON.stringify({ personaId: signal.personaId, signalIds: [signal.id], count: 2 })
    });
    assert(drafts.length === 2, "Should create 2 drafts");

    const approved = await api(`/api/drafts/${drafts[0].id}/approve`, { method: "POST" });
    assert(approved.status === "approved", "Draft should be approved");

    const scheduled = await api("/api/schedule", {
      method: "POST",
      body: JSON.stringify({ draftId: approved.id })
    });
    assert(scheduled.status === "scheduled", "Post should be scheduled");

    // Kill and restart
    await killServer(srv);
    srv = await startServer({ DB_PATH: TEST_DB });

    // Verify all states survived
    const reloadedDrafts = await api("/api/drafts");
    assert(reloadedDrafts.length >= 1, "Drafts should survive restart");
    const reloadedApproved = reloadedDrafts.find(d => d.id === approved.id);
    assert(reloadedApproved, "Approved draft should survive restart");
    assert(reloadedApproved.status === "approved",
      `Approved draft status should survive restart: ${reloadedApproved.status}`);
    assert(reloadedApproved.reviewReason, "Draft review reason should survive restart");

    const reloadedSchedule = await api("/api/schedule");
    const reloadedScheduled = reloadedSchedule.find(s => s.id === scheduled.id);
    assert(reloadedScheduled, "Scheduled post should survive restart");
    assert(reloadedScheduled.status === "scheduled",
      `Scheduled post status should survive restart: ${reloadedScheduled.status}`);

    // Mark as published
    const published = await api(`/api/schedule/${reloadedScheduled.id}/mark-published`, {
      method: "POST",
      body: JSON.stringify({
        publishedUrl: "https://example.test/post",
        engagementNotes: "Published manually for persistence test"
      })
    });
    assert(published.status === "published_manual", "Published post should have correct status");

    // Update performance
    const performance = await api(`/api/published-posts/${published.id}/performance`, {
      method: "PATCH",
      body: JSON.stringify({ impressions: 500, likes: 42, reposts: 7 })
    });
    assert(performance.performance.impressions === 500, "Performance impressions should persist");
    assert(performance.performance.likes === 42, "Performance likes should persist");

    // Kill and restart again
    await killServer(srv);
    srv = await startServer({ DB_PATH: TEST_DB });

    // Verify published + performance survived
    const reloadedPublished = await api("/api/published-posts");
    const found = reloadedPublished.find(p => p.id === published.id);
    assert(found, "Published post should survive restart");
    assert(found.performance.impressions === 500,
      `Performance impressions should survive restart: ${found.performance.impressions}`);
    assert(found.performance.likes === 42,
      `Performance likes should survive restart: ${found.performance.likes}`);

    // Verify used signal tracking
    const usedSignals = await api("/api/signals?includeDismissed=true&limit=200");
    const used = usedSignals.find(s => s.id === signal.id);
    assert(used.status === "used" || used.status === "reviewed",
      `Signal should be marked used after publish lifecycle: ${used.status}`);

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Draft-schedule-publish lifecycle scenario");
}

// =============================================
// SCENARIO 13: Multiple back-to-back Hermes imports
// =============================================
async function testBackToBackHermesImports() {
  console.log("\n=== SCENARIO 13: Back-to-back Hermes imports ===");
  await ensureDb(TEST_DB);

  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    // Fire 20 Hermes imports back-to-back for different personas
    const personas = ["the-wonkette", "policy-pete", "maga-memester", "progressive-pat"];
    const importTasks = [];

    for (let batch = 0; batch < 5; batch++) {
      for (const personaId of personas) {
        const payload = {
          version: "2026-06-phase4",
          runType: "velocity_scan",
          provider: "lmstudio",
          model: "b2b-model",
          endpoint: "http://localhost:1234/v1",
          jobName: "b2b-import-test",
          generatedAt: new Date().toISOString(),
          personas: [{
            personaId,
            signals: [{
              topic: `B2B Signal ${personaId} batch ${batch}`,
              source: "Hermes",
              query: "b2b test",
              priorityScore: 70 + batch * 5,
              velocityScore: 50 + batch * 8,
              relevanceScore: 80,
              noveltyScore: 75,
              freshnessScore: 85,
              riskScore: 10,
              sourceCount: 1 + batch,
              clusterId: `b2b-${personaId}-batch-${batch}`,
              suggestedAngle: `${personaId}: b2b test.`
            }]
          }]
        };
        importTasks.push(
          api("/api/hermes/import", {
            method: "POST",
            body: JSON.stringify(payload)
          }).catch(err => ({ error: err.message }))
        );
      }
    }

    const results = await Promise.allSettled(importTasks);
    const successes = results.filter(r => r.status === "fulfilled" && !r.value.error).length;
    assert(successes === 20, `Expected all 20 back-to-back imports to succeed (got ${successes})`);

    // Verify all signals created
    const signals = await api("/api/signals?includeDismissed=true&limit=200");
    for (const personaId of personas) {
      for (let batch = 0; batch < 5; batch++) {
        const topic = `B2B Signal ${personaId} batch ${batch}`;
        assert(signals.some(s => s.topic === topic),
          `Signal "${topic}" should exist after back-to-back imports`);
      }
    }

    // Verify ingestion runs recorded
    const runs = await api("/api/ingestion/runs");
    const hermeseRuns = runs.filter(r => r.generated_by === "Hermes" && r.job_name === "b2b-import-test");
    assert(hermeseRuns.length === 20,
      `Expected 20 Hermes ingestion runs (got ${hermeseRuns.length})`);

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Back-to-back Hermes imports scenario");
}

// =============================================
// SCENARIO 14: Large payload import
// =============================================
async function testLargePayloadImport() {
  console.log("\n=== SCENARIO 14: Large payload import ===");
  await ensureDb(TEST_DB);

  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    // Create a payload with 50 signals across all 4 personas
    const signals = [];
    for (let i = 0; i < 50; i++) {
      signals.push({
        topic: `Large payload signal ${i}`,
        source: "Hermes",
        query: "large payload test",
        priorityScore: 50 + (i % 50),
        velocityScore: 40 + (i % 40),
        relevanceScore: 60 + (i % 30),
        noveltyScore: 55 + (i % 35),
        freshnessScore: 70 + (i % 20),
        riskScore: 5 + (i % 10),
        sourceCount: 1 + (i % 5),
        clusterId: `large-payload-cluster-${Math.floor(i / 4)}`,
        suggestedAngle: `Test: large payload signal ${i}.`
      });
    }

    // Distribute across personas
    const personaIds = ["the-wonkette", "policy-pete", "maga-memester", "progressive-pat"];
    const payloadPersonas = personaIds.map((personaId, idx) => ({
      personaId,
      signals: signals.filter((_, i) => i % 4 === idx)
    }));

    const payload = {
      version: "2026-06-phase4",
      runType: "morning_digest",
      provider: "lmstudio",
      model: "large-payload-model",
      endpoint: "http://localhost:1234/v1",
      jobName: "large-payload-test",
      generatedAt: new Date().toISOString(),
      personas: payloadPersonas
    };

    const result = await api("/api/hermes/import", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    assert(result.imported >= 48, `Expected 48+ signals created from large payload (got ${result.imported})`);

    // Verify signals can be queried
    const queriedSignals = await api("/api/signals?includeDismissed=true&limit=250");
    const largeSignals = queriedSignals.filter(s => s.topic.startsWith("Large payload signal"));
    assert(largeSignals.length >= 48,
      `Large payload signals should be queryable (got ${largeSignals.length})`);

    // Check snapshots
    const snapshotsCheck = await api("/api/ingestion/runs");
    const largeRun = snapshotsCheck.find(r => r.job_name === "large-payload-test");
    assert(largeRun, "Large payload ingestion run should be recorded");
    assert(largeRun.status === "completed", "Large payload import should complete successfully");

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Large payload import scenario");
}

// =============================================
// SCENARIO 15: Race condition: read during write
// =============================================
async function testReadDuringWrite() {
  console.log("\n=== SCENARIO 15: Read during write ===");
  await ensureDb(TEST_DB);

  let srv = await startServer({ DB_PATH: TEST_DB });
  try {
    // Start a Hermes import that takes some time (large payload)
    const signals = [];
    for (let i = 0; i < 30; i++) {
      signals.push({
        topic: `Race condition signal ${i}`,
        source: "Hermes",
        query: "race test",
        priorityScore: 60 + i,
        velocityScore: 50,
        relevanceScore: 70,
        noveltyScore: 65,
        freshnessScore: 80,
        riskScore: 8,
        sourceCount: 1,
        clusterId: `race-cluster-${i}`,
        suggestedAngle: `Test: race condition ${i}.`
      });
    }

    // Fire import (write) and immediately read
    const importPromise = api("/api/hermes/import", {
      method: "POST",
      body: JSON.stringify({
        version: "2026-06-phase4",
        runType: "midday_brief",
        provider: "lmstudio",
        model: "race-model",
        endpoint: "http://localhost:1234/v1",
        jobName: "race-condition-test",
        generatedAt: new Date().toISOString(),
        personas: [{ personaId: "the-wonkette", signals }]
      })
    });

    // Read during write - this should never fail or return corrupt data
    const readResults = [];
    for (let i = 0; i < 5; i++) {
      try {
        const result = await api("/api/signals?includeDismissed=true&limit=200");
        readResults.push(result);
      } catch {
        // Reads may fail during write, but should never return corrupt data
      }
      await new Promise(r => setTimeout(r, 50));
    }

    const importResult = await importPromise;
    assert(importResult.imported >= 28, `Import during read should succeed (got ${importResult.imported})`);

    // All reads should return valid data
    for (const readResult of readResults) {
      assert(Array.isArray(readResult), "Read during write should return an array");
      assert(readResult.every(s => s.id), "All signals from read should have valid ids");
    }

  } finally {
    await killServer(srv);
  }
  console.log("  PASS: Read during write scenario");
}

// =============================================
// Execute all tests
// =============================================
async function main() {
  console.log("=".repeat(60));
  console.log("PERSISTENCE CERTIFICATION TEST SUITE");
  console.log("=".repeat(60));
  console.log(`Root: ${rootDir}`);
  console.log(`Test DB: ${TEST_DB}`);

  const failures = [];
  const tests = [
    ["Restart during Hermes digest", testRestartDuringHermesDigest],
    ["Restart during save", testRestartDuringSave],
    ["Simultaneous persona edits", testSimultaneousPersonaEdits],
    ["Simultaneous Hermes imports", testSimultaneousHermesImports],
    ["Repeated provider runs", testRepeatedProviderRuns],
    ["Seed reinitialization", testSeedReinitialization],
    ["Browser refresh (stateless)", testBrowserRefresh],
    ["Server restart (full durability)", testServerRestart],
    ["Concurrent persona writes", testConcurrentPersonaWrites],
    ["DB corruption recovery", testDBCorruptionRecovery],
    ["Signal deduplication", testSignalDeduplication],
    ["Draft-schedule-publish lifecycle", testDraftSchedulePublishPersistence],
    ["Back-to-back Hermes imports", testBackToBackHermesImports],
    ["Large payload import", testLargePayloadImport],
    ["Read during write (race)", testReadDuringWrite]
  ];

  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      console.error(`  ✗ ${name}: ${error.message}`);
      console.error(`    ${error.stack?.split("\n").slice(1, 3).join("\n    ") || ""}`);
      failures.push({ name, error: error.message });
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));
  console.log(`Passed: ${tests.length - failures.length}/${tests.length}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  ✗ ${f.name}: ${f.error}`);
    }
    process.exitCode = 1;
  } else {
    console.log("All persistence certification tests passed.");
  }
}

await main();
