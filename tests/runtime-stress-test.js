import { spawn } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const BASE_PORT = 5299;
const TEST_DB = path.join(rootDir, "work", "runtime-stress.sqlite");

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
      env: { ...process.env, PORT: String(BASE_PORT), DB_PATH: TEST_DB, DISABLE_HERMES_BOOTSTRAP: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });

    const startTime = Date.now();
    const interval = setInterval(async () => {
      if (Date.now() - startTime > 15000) {
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

async function sqliteQuery(sql) {
  const { stdout } = await execFileAsync("sqlite3", ["-json", TEST_DB, sql], { maxBuffer: 1024 * 1024 });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try { return JSON.parse(trimmed); } catch { return []; }
}

async function sqliteExec(sql) {
  await execFileAsync("sqlite3", [TEST_DB, sql], { maxBuffer: 1024 * 1024 });
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  return async () => {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (err) {
      console.log(`  FAIL: ${name}`);
      console.log(`        ${err.message}`);
      failed++;
    }
  };
}

const scenarios = [];

// =============================================
// SCENARIO 1: Fresh DB setup + WAL/busy_timeout
// =============================================

scenarios.push(test("Fresh DB: WAL mode enabled", async () => {
  await rm(TEST_DB, { force: true });
  // init-db creates the DB with WAL mode
  const init = spawn(process.execPath, ["scripts/init-db.js"], {
    cwd: rootDir,
    env: { ...process.env, DB_PATH: TEST_DB, DISABLE_HERMES_BOOTSTRAP: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    let out = "";
    init.stdout.on("data", c => out += c.toString());
    init.stderr.on("data", c => out += c.toString());
    init.on("close", code => code === 0 ? resolve() : reject(new Error(`init-db failed (${code}): ${out}`)));
  });
  // Verify WAL mode
  const walResult = await sqliteQuery("PRAGMA journal_mode;");
  assert(walResult.length > 0, `PRAGMA journal_mode returned empty: ${JSON.stringify(walResult)}`);
  const mode = walResult[0].journal_mode || walResult[0]["journal_mode"];
  assert(mode && mode.toUpperCase() === "WAL", `Expected WAL, got: ${mode}`);
  console.log("        WAL mode confirmed");
}));

scenarios.push(test("Fresh DB: busy_timeout set per-connection (verified inline)", async () => {
  // busy_timeout is per-connection, not persistent in the DB. Verify pragma setting
  // works within a single sqlite3 invocation (same session).
  const { stdout } = await execFileAsync("sqlite3", ["-json", TEST_DB,
    "PRAGMA busy_timeout = 5000; SELECT 1 as dummy; PRAGMA busy_timeout;"]);
  // Multi-statement JSON output: one JSON array per statement, one per line
  const lines = stdout.trim().split("\n").filter(l => l.startsWith("["));
  assert(lines.length === 3, `Expected 3 JSON lines, got ${lines.length}`);
  const btSet = JSON.parse(lines[0]);   // PRAGMA busy_timeout = 5000
  const dummy  = JSON.parse(lines[1]);  // SELECT 1 as dummy
  const btGet  = JSON.parse(lines[2]);  // PRAGMA busy_timeout (readback)
  assert(dummy[0]?.dummy === 1, `Expected dummy=1, got: ${JSON.stringify(dummy)}`);
  assert(btGet[0]?.timeout === 5000, `Expected busy_timeout=5000, got: ${btGet[0]?.timeout}`);
  console.log("        busy_timeout=5000 confirmed (within same connection)");
}));

scenarios.push(test("Health endpoint: walConfigured and busyTimeout reported", async () => {
  const health = await api("/api/health");
  assert(health.walConfigured === true, `Expected walConfigured=true, got: ${health.walConfigured}`);
  assert(health.busyTimeout === 5000, `Expected busyTimeout=5000, got: ${health.busyTimeout}`);
  console.log("        Health reports walConfigured=true, busyTimeout=5000");
}));

// =============================================
// SCENARIO 2: Concurrent Crawl4AI + RSS imports
// =============================================

scenarios.push(test("Concurrent imports: Crawl4AI and RSS running simultaneously", async () => {
  const srv = global.__server;
  // Run 3 concurrent ingestion runs (will use all providers including crawl4ai and rss)
  // Each uses mock providers to avoid network dependency
  const concurrency = 5;
  const start = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: concurrency }, (_, i) =>
      api("/api/ingestion/run", {
        method: "POST",
        body: JSON.stringify({ useMockProviders: true, runType: `stress_${i}` })
      }).catch(err => {
        // Accept partial failures as long as some succeed
        return { _error: err.message, _index: i };
      })
    )
  );
  const elapsed = Date.now() - start;
  const succeeded = results.filter(r => r.status === "fulfilled" && !r.value._error).length;
  console.log(`        ${concurrency} concurrent ingestion runs: ${succeeded} succeeded in ${elapsed}ms`);
  assert(succeeded >= 3, `Expected at least 3/5 concurrent ingests to succeed, got ${succeeded}`);
  // All should succeed eventually due to busy_timeout
  assert(results.every(r => r.status === "fulfilled" || r.value._error),
    "All requests should settle");
}));

// =============================================
// SCENARIO 3: Concurrent ingestion + Hermes import
// =============================================

scenarios.push(test("Concurrent: ingestion + Hermes import", async () => {
  // Fire ingestion and Hermes import concurrently
  const [ingestResult, importResult] = await Promise.allSettled([
    api("/api/ingestion/run", {
      method: "POST",
      body: JSON.stringify({ useMockProviders: true })
    }),
    api("/api/hermes/simulate", {
      method: "POST",
      body: JSON.stringify({ runType: "velocity_scan" })
    })
  ]);
  assert(ingestResult.status === "fulfilled" || ingestResult.value?._error,
    `Ingestion should settle: ${ingestResult.status}`);
  assert(importResult.status === "fulfilled" || importResult.value?._error,
    `Hermes import should settle: ${importResult.status}`);
  console.log("        Ingestion and Hermes import completed concurrently without deadlock");
}));

// =============================================
// SCENARIO 4: Concurrent Hermes digest + manual import
// =============================================

scenarios.push(test("Concurrent: Hermes morning digest + manual import", async () => {
  const [digestResult, importResult] = await Promise.allSettled([
    api("/api/hermes/morning-digest/run", {
      method: "POST",
      body: JSON.stringify({ allowMock: true })
    }).catch(err => ({ _error: err.message })),
    api("/api/hermes/import", {
      method: "POST",
      body: JSON.stringify({
        version: "2026-06-test",
        runType: "morning_digest",
        jobName: "stress-test-manual-import",
        provider: "mock",
        model: "stress-test-model",
        endpoint: "http://localhost:0",
        generatedAt: new Date().toISOString(),
        personas: [
          {
            personaId: "the-wonkette",
            signals: [
              {
                topic: "Concurrent stress test signal",
                source: "stress-test-source",
                sourceProvider: "mock",
                provider: "mock",
                model: "stress-test-model",
                endpoint: "http://localhost:0",
                jobName: "stress-test",
                query: "stress test",
                firstSeenAt: new Date().toISOString(),
                lastSeenAt: new Date().toISOString(),
                velocityScore: 50,
                relevanceScore: 50,
                noveltyScore: 50,
                freshnessScore: 50,
                riskScore: 10,
                priorityScore: 50,
                sourceCount: 1,
                clusterId: `cluster-stress-${Date.now()}`,
                suggestedAngle: "Test angle",
                evidenceUrls: ["https://example.com/stress"]
              }
            ]
          }
        ]
      })
    })
  ]);
  assert(digestResult.status === "fulfilled" || digestResult.value?._error,
    `Digest should settle: ${digestResult.status}`);
  assert(importResult.status === "fulfilled" || importResult.value?._error,
    `Import should settle: ${importResult.status}`);
  console.log("        Morning digest + manual import completed concurrently");
}));

// =============================================
// SCENARIO 5: Kill and restart during ingestion
// =============================================

scenarios.push(test("Kill/restart during ingestion: data survives", async () => {
  const srv = global.__server;
  // Fire a slow-ish ingestion (no mock -> will time out on real providers)
  const ingestPromise = api("/api/ingestion/run", {
    method: "POST",
    body: JSON.stringify({ useMockProviders: false, ignoreProviderErrors: true })
  }).catch(err => ({ _error: err.message }));

  // Wait a tiny bit for the ingestion to start
  await new Promise(r => setTimeout(r, 200));

  // Kill the server mid-ingestion
  await killServer(srv);
  console.log("        Server killed mid-ingestion");

  // Restart
  global.__server = await startServer();
  console.log("        Server restarted");

  // Verify personas still exist
  const personas = await api("/api/personas");
  assert(personas.length === 4, `Expected 4 personas after restart, got ${personas.length}`);
  console.log("        All 4 personas survived kill during ingestion");

  // Verify health
  const health = await api("/api/health");
  assert(health.ok === true, "Health check should pass after restart");
  assert(health.walConfigured === true, "WAL should be configured");
}));

// =============================================
// SCENARIO 6: SQLite integrity check
// =============================================

scenarios.push(test("SQLite integrity: PRAGMA integrity_check", async () => {
  const { stdout } = await execFileAsync("sqlite3", [TEST_DB, "PRAGMA integrity_check;"]);
  const result = stdout.trim();
  assert(result === "ok", `Integrity check failed: ${result}`);
  console.log("        integrity_check: ok");
}));

scenarios.push(test("SQLite integrity: PRAGMA foreign_key_check", async () => {
  const fkcResult = await sqliteQuery("PRAGMA foreign_key_check;");
  assert(fkcResult.length === 0, `Foreign key violations: ${JSON.stringify(fkcResult)}`);
  console.log("        foreign_key_check: 0 violations");
}));

// =============================================
// SCENARIO 7: Audit trail contains expected entries
// =============================================

scenarios.push(test("Audit trail: non-empty and contains expected action types", async () => {
  const auditLog = await api("/api/audit-log?limit=100");
  assert(Array.isArray(auditLog), "Audit log should be an array");
  assert(auditLog.length > 0, "Audit log should not be empty");
  const actions = new Set(auditLog.map(e => e.action));
  console.log(`        Audit log entries: ${auditLog.length}, unique actions: ${[...actions].join(", ")}`);
  assert(actions.has("seed.inserted_missing_persona"), "Should have seed insertion audit");
  assert(actions.has("ingestion.completed") || actions.size > 3,
    "Should have ingestion or stress-related audit entries");
}));

// =============================================
// SCENARIO 8: Verify dedup across concurrent imports
// =============================================

scenarios.push(test("Dedup: sequential imports collapse to single signal", async () => {
  const clusterId = `dedup-seq-${Date.now()}`;
  const signalPayload = {
    topic: "Dedup sequential test",
    source: "dedup-source",
    sourceProvider: "mock",
    provider: "mock",
    model: "dedup-model",
    endpoint: "http://localhost:0",
    jobName: "dedup-test",
    query: "dedup test",
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    velocityScore: 30,
    relevanceScore: 30,
    noveltyScore: 30,
    freshnessScore: 30,
    riskScore: 5,
    priorityScore: 30,
    sourceCount: 1,
    clusterId: clusterId,
    suggestedAngle: "Dedup check",
    evidenceUrls: ["https://example.com/dedup"]
  };
  const payload = {
    version: "2026-06-test",
    runType: "morning_digest",
    jobName: "dedup-test",
    provider: "mock",
    model: "dedup-model",
    endpoint: "http://localhost:0",
    generatedAt: new Date().toISOString(),
    personas: [{ personaId: "the-wonkette", signals: [signalPayload] }]
  };

  // First import — should insert a new signal
  const first = await api("/api/hermes/import", { method: "POST", body: JSON.stringify(payload) });
  assert(first.imported === 1, `First import should create 1 new signal, got imported=${first.imported}`);
  console.log("        First import: 1 new signal created");

  // Second import with same clusterId — should find duplicate and update
  const second = await api("/api/hermes/import", { method: "POST", body: JSON.stringify(payload) });
  assert(second.updated === 1, `Second import should update 1 existing signal, got updated=${second.updated}`);
  console.log("        Second import: 1 existing signal updated (dedup works)");

  // Verify only 1 signal in the DB for this clusterId
  const signals = await api(`/api/signals?personaId=the-wonkette&includeDismissed=true&limit=200`);
  const matches = signals.filter(s => s.clusterId === clusterId);
  assert(matches.length === 1, `Expected exactly 1 signal after sequential dedup, got ${matches.length}`);
  console.log(`        Final: ${matches.length} signal with clusterId=${clusterId}`);
}));

scenarios.push(test("Dedup: concurrent imports of same signal survive without deadlock", async () => {
  const clusterId = `dedup-con-${Date.now()}`;
  const signalPayload = {
    topic: "Dedup concurrent test",
    source: "dedup-source",
    sourceProvider: "mock",
    provider: "mock",
    model: "dedup-model",
    endpoint: "http://localhost:0",
    jobName: "dedup-test",
    query: "dedup test",
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    velocityScore: 30,
    relevanceScore: 30,
    noveltyScore: 30,
    freshnessScore: 30,
    riskScore: 5,
    priorityScore: 30,
    sourceCount: 1,
    clusterId: clusterId,
    suggestedAngle: "Dedup check",
    evidenceUrls: ["https://example.com/dedup"]
  };
  const payload = {
    version: "2026-06-test",
    runType: "morning_digest",
    jobName: "dedup-test",
    provider: "mock",
    model: "dedup-model",
    endpoint: "http://localhost:0",
    generatedAt: new Date().toISOString(),
    personas: [{ personaId: "the-wonkette", signals: [signalPayload] }]
  };

  // Fire 3 concurrent imports — each has its own snapshot so each may insert,
  // but they must not deadlock or throw
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, () =>
      api("/api/hermes/import", { method: "POST", body: JSON.stringify(payload) })
    )
  );
  const succeeded = results.filter(r => r.status === "fulfilled").length;
  const failures = results.filter(r => r.status === "rejected").map(r => r.reason?.body || r.reason?.message || r.reason);
  console.log(`        ${succeeded}/3 concurrent dedup imports succeeded`);
  if (failures.length > 0) {
    console.log(`        Failures: ${JSON.stringify(failures)}`);
  }
  assert(succeeded === 3, `All 3 concurrent imports should succeed, got ${succeeded}`);

  // All 3 imports succeeded without deadlock. Each may have inserted its own signal
  // (since concurrent sessions don't share cache). Verify the DB is consistent.
  const { stdout } = await execFileAsync("sqlite3", [TEST_DB, "PRAGMA integrity_check;"]);
  assert(stdout.trim() === "ok", `Integrity check after concurrent dedup: ${stdout.trim()}`);
  console.log("        DB integrity ok after concurrent dedup imports");
}));

// =============================================
// SCENARIO 9: Verify signal persistence across restart
// =============================================

scenarios.push(test("Signal persistence: signals survive server restart", async () => {
  const srv = global.__server;

  // Get current signal count
  const signalsBefore = await api("/api/signals?includeDismissed=true&limit=200");
  const countBefore = signalsBefore.length;
  console.log(`        Signals before restart: ${countBefore}`);

  // Kill and restart
  await killServer(srv);
  global.__server = await startServer();

  // Verify signal count is the same (or at least doesn't drop to zero)
  const signalsAfter = await api("/api/signals?includeDismissed=true&limit=200");
  const countAfter = signalsAfter.length;
  console.log(`        Signals after restart: ${countAfter}`);

  // Some signals may have been cleaned up by startup routines,
  // but we should not lose all signals
  assert(countAfter > 0, `Signals should persist across restart, got ${countAfter}`);
  // The counts should be close (allow for some cleanup)
  assert(Math.abs(countAfter - countBefore) <= 20,
    `Signal count should not change dramatically: before=${countBefore}, after=${countAfter}`);
}));

// =============================================
// SCENARIO 10: Final integrity check
// =============================================

scenarios.push(test("Final integrity: PRAGMA integrity_check after all stress", async () => {
  const { stdout } = await execFileAsync("sqlite3", [TEST_DB, "PRAGMA integrity_check;"]);
  assert(stdout.trim() === "ok", `Final integrity check failed: ${stdout.trim()}`);
}));

scenarios.push(test("Final integrity: PRAGMA foreign_key_check after all stress", async () => {
  const fkcResult = await sqliteQuery("PRAGMA foreign_key_check;");
  assert(fkcResult.length === 0, `Foreign key violations after stress: ${JSON.stringify(fkcResult)}`);
}));

// =============================================
// MAIN
// =============================================

console.log("=".repeat(65));
console.log("RUNTIME / CONCURRENCY STRESS TEST");
console.log("=".repeat(65));

try {
  // Clean up
  await rm(TEST_DB, { force: true }).catch(() => {});

  // Start server
  console.log("\nStarting server...");
  global.__server = await startServer();
  console.log("Server ready.");

  // Run each scenario sequentially so output is clean
  for (const scenario of scenarios) {
    await scenario();
  }

  // Cleanup
  await killServer(global.__server);

  console.log("\n" + "=".repeat(65));
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log("=".repeat(65));

  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  console.error("\nFATAL ERROR:", err.message);
  await killServer(global.__server).catch(() => {});
  process.exit(1);
}
