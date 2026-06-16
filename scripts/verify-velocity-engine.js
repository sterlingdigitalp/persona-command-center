#!/usr/bin/env node
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const dbPath = process.env.DB_PATH || path.join(rootDir, "work", "velocity-verification.sqlite");
const port = Number(process.env.PCC_VELOCITY_PORT || 3321);
const baseUrl = (process.env.PCC_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
const ownsServer = !process.env.PCC_BASE_URL;
const report = { pass: true, checks: [], errors: [] };

function addCheck(name, ok, detail = "") {
  report.checks.push({ name, ok, detail });
  if (!ok) report.pass = false;
}

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `${pathname} returned ${response.status}`);
  return json;
}

async function waitForServer(child) {
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    try {
      const health = await api("/api/health");
      if (health.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Server did not start. Logs:\n${logs}`);
}

let child = null;

try {
  if (ownsServer) {
    await rm(dbPath, { force: true });
    child = spawn("node", ["src/server.js"], {
      cwd: rootDir,
      env: {
        ...process.env,
        DB_PATH: dbPath,
        PORT: String(port),
        DISABLE_HERMES_BOOTSTRAP: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    await waitForServer(child);
  }

  const personas = await api("/api/personas");
  const persona = personas[0];
  if (!persona) throw new Error("No personas available");
  const clusterId = `velocity-verification-${Date.now()}`;
  const topic = "Velocity Verification Signal";
  const generatedAt = new Date().toISOString();

  for (const [index, sourceCount] of [2, 9, 16].entries()) {
    await api("/api/hermes/import", {
      method: "POST",
      body: JSON.stringify({
        version: "2026-06-phase4f",
        runType: index === 0 ? "morning_digest" : index === 1 ? "midday_brief" : "velocity_scan",
        provider: "lmstudio",
        model: "qwen3.6-35b-a3b-mtp",
        endpoint: "http://localhost:1234/v1",
        jobName: "velocity-verification",
        generatedAt,
        personas: [{
          personaId: persona.id,
          signals: [{
            topic,
            source: "Hermes",
            query: "velocity verification",
            firstSeenAt: generatedAt,
            lastSeenAt: new Date(Date.now() + index * 1000).toISOString(),
            velocityScore: 45 + index * 20,
            relevanceScore: 80,
            noveltyScore: 70,
            freshnessScore: 90,
            priorityScore: 60 + index * 16,
            riskScore: 10,
            sourceCount,
            clusterId,
            suggestedAngle: `${persona.name}: velocity verification.`
          }]
        }]
      })
    });
  }

  const alerts = await api("/api/velocity-alerts");
  const matchingAlerts = alerts.filter((alert) => alert.topic === topic);
  const latest = await api("/api/velocity/latest");
  addCheck("snapshots exist", Number(latest.snapshotsEvaluated || 0) > 0, String(latest.snapshotsEvaluated || 0));
  addCheck("alerts created", matchingAlerts.length > 0, `${matchingAlerts.length} matching`);
  addCheck("acceleration scores calculated", matchingAlerts.some((alert) => alert.accelerationScore >= 60), String(matchingAlerts[0]?.accelerationScore || 0));
  addCheck("alert levels assigned", matchingAlerts.some((alert) => ["watch", "rising", "viral_window"].includes(alert.alertLevel)), matchingAlerts[0]?.alertLevel || "none");
  addCheck("latest endpoint works", Array.isArray(latest.topAlerts), `${latest.topAlerts?.length || 0} top alerts`);

  const quiet = await api(`/api/velocity-alerts?level=watch&personaId=${encodeURIComponent(persona.id)}`);
  addCheck("filtered alert endpoint works", Array.isArray(quiet), `${quiet.length} filtered alerts`);
} catch (error) {
  report.pass = false;
  report.errors.push(error.message);
} finally {
  if (child) child.kill("SIGTERM");
}

console.log(report.pass ? "PASS velocity engine verification" : "FAIL velocity engine verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
for (const error of report.errors) console.log(`ERROR - ${error}`);
process.exit(report.pass ? 0 : 1);
