#!/usr/bin/env node
const baseUrl = (process.env.PCC_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
// Aligned with server's OPERATOR_NOISE_PATTERNS (src/server.js:224).
// /\btest\b/i is intentionally absent — it matches natural language in
// legitimate signals (e.g. "stress test"). The server uses a separate
// test_mode column to filter test-only signals.
const bannedPatterns = [
  /\bmock\b/i,
  /\bdemo\b/i,
  /\btrial\b/i,
  /\bvalidation\b/i,
  /\bsmoke\b/i,
  /hermes\.local/i,
  /example/i,
  /searchagent unavailable/i,
  /new opportunity detected/i,
  /crawl4ai mock/i
];
const report = { pass: true, checks: [] };

function addCheck(name, ok, detail = "") {
  report.checks.push({ name, ok, detail });
  if (!ok) report.pass = false;
}

async function api(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(json.error || text || `${path} ${response.status}`);
  return json;
}

try {
  const queue = await api("/api/operator/queue");
  const personas = queue.personas || [];
  const visible = personas.flatMap((item) => [
    ...(item.signals || []).map((signal) => ({ type: "signal", id: signal.id, text: JSON.stringify(signal) })),
    ...(item.drafts || []).map((draft) => ({ type: "draft", id: draft.id, text: JSON.stringify(draft) }))
  ]);
  const dirty = visible.filter((item) => bannedPatterns.some((pattern) => pattern.test(item.text)));
  const testModeSignals = personas.flatMap((item) => (item.signals || [])).filter((s) => s.testMode === true);
  addCheck("operator queue reachable", Array.isArray(personas), `${personas.length} personas`);
  addCheck("default Operator has no mock/demo/test/fallback rows", dirty.length === 0, dirty.slice(0, 5).map((item) => `${item.type}:${item.id}`).join(", "));
  addCheck("no signals with testMode=true visible", testModeSignals.length === 0, testModeSignals.map((s) => s.id).join(", "));
} catch (error) {
  addCheck("operator queue reachable", false, error.message);
}

console.log(report.pass ? "PASS operator production clean verification" : "FAIL operator production clean verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
process.exit(report.pass ? 0 : 1);
