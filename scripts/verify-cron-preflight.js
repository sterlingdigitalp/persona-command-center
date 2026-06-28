#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const bridgePath = process.env.HERMES_WATCHLIST_PROCESSOR
  || "/Users/sterlingdigital/hermes-peptide-intelligence/search_agent/services/watch_list_processor.py";
const preflightPath = process.env.PCC_MORNING_PREFLIGHT || `${process.env.HOME}/bin/pcc-morning-preflight.sh`;
const report = { pass: true, checks: [] };

function addCheck(name, ok, detail = "") {
  report.checks.push({ name, ok, detail });
  if (!ok) report.pass = false;
}

async function readMaybe(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    return `__READ_FAILED__:${error.message}`;
  }
}

const bridge = await readMaybe(bridgePath);
const preflight = await readMaybe(preflightPath);

addCheck("bridge script readable", !bridge.startsWith("__READ_FAILED__"), bridge.startsWith("__READ_FAILED__") ? bridge : bridgePath);
addCheck("preflight script readable", !preflight.startsWith("__READ_FAILED__"), preflight.startsWith("__READ_FAILED__") ? preflight : preflightPath);
addCheck("bridge production command is direct", bridge.includes("--production") && bridge.includes("--pcc-base-url"), "expected production CLI flags");
addCheck("bridge checks PCC health/export", bridge.includes("/api/health") && bridge.includes("/api/hermes/export"), "requires both health and export preflight");
addCheck("bridge checks SearXNG before import", /searxng|SEARXNG/i.test(bridge) && /preflight|health/i.test(bridge), "requires SearXNG health preflight");
addCheck("failed retrievals skip imports", /retrieval_failed/i.test(bridge) && /continue|skip/i.test(bridge), "requires explicit skip/no import path");
addCheck("fallback opportunity topic removed", !bridge.includes("new opportunity detected"), "bridge must not build fallback opportunity topics");
addCheck("preflight mentions SearXNG", /searxng/i.test(preflight), "macOS preflight should ensure SearXNG is ready");

console.log(report.pass ? "PASS cron preflight verification" : "FAIL cron preflight verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
process.exit(report.pass ? 0 : 1);
