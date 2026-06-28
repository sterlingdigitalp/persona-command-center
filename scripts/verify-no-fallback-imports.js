#!/usr/bin/env node
import { rm } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const tempDb = path.join(rootDir, "work", `verify-no-fallback-imports-${Date.now()}.sqlite`);
process.env.DB_PATH = tempDb;

const { initDb, querySql } = await import("../src/db.js");
const { importHermesPayload } = await import("../src/hermes/hermesImport.js");

const report = { pass: true, checks: [] };
function addCheck(name, ok, detail = "") {
  report.checks.push({ name, ok, detail });
  if (!ok) report.pass = false;
}

await initDb();

const fallbackPayload = {
  runType: "morning_digest",
  generatedAt: new Date().toISOString(),
  provider: "SearchAgent",
  model: "search_agent_v1",
  endpoint: "search_agent://x_search/none",
  jobName: "verify-no-fallback-imports",
  personas: [{
    personaId: "policy-pete",
    signals: [{
      topic: "Watch List entity Paul Graham (@paulg) — new opportunity detected",
      source: "hermes_x_search",
      query: "Watch List: Paul Graham (@paulg)",
      sourceProvider: "SearchAgent",
      suggestedAngle: "Timely opportunity from monitored entity Paul Graham",
      evidenceUrls: ["hermes_x_search — SearchAgent unavailable (None)"],
      rawData: {
        retrievalStatus: "retrieval_failed",
        error: "SearchAgent unavailable"
      }
    }]
  }]
};

let rejected = false;
try {
  await importHermesPayload(fallbackPayload);
} catch (error) {
  rejected = /failed-retrieval|fallback|evidenceUrls|retrieval/i.test(error.message);
}
addCheck("fallback payload is rejected", rejected, rejected ? "rejected before import" : "fallback import was accepted");

const rows = await querySql(`
  SELECT id, topic, evidence_urls
  FROM signals
  WHERE LOWER(COALESCE(topic, '')) LIKE '%new opportunity detected%'
     OR LOWER(COALESCE(evidence_urls, '')) LIKE '%searchagent unavailable%';
`);
addCheck("no fallback signal rows created", rows.length === 0, `${rows.length} fallback rows`);

await rm(tempDb, { force: true });
await rm(`${tempDb}-wal`, { force: true });
await rm(`${tempDb}-shm`, { force: true });

console.log(report.pass ? "PASS no fallback imports verification" : "FAIL no fallback imports verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
process.exit(report.pass ? 0 : 1);
