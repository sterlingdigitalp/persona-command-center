#!/usr/bin/env node
const baseUrl = (process.env.PCC_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

function hasAttribution(result) {
  return Boolean(result?.runType === "velocity_scan" && result?.runId);
}

function printResult(status, lines = []) {
  console.log(`${status} persona-command-center velocity scan`);
  for (const line of lines) console.log(line);
}

try {
  const now = new Date().toISOString();
  const body = {
    provider: process.env.HERMES_PROVIDER || "lmstudio",
    model: process.env.HERMES_MODEL || "qwen3.6-35b-a3b-mtp",
    endpoint: process.env.HERMES_ENDPOINT || "http://localhost:1234/v1",
    jobName: process.env.HERMES_JOB_NAME || "persona-command-center-velocity-scan",
    runType: "velocity_scan",
    generatedAt: now,
    personas: []
  };

  const response = await fetch(`${baseUrl}/api/hermes/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    printResult("FAIL", [`status: ${response.status}`, `error: ${result.error || JSON.stringify(result)}`]);
    process.exit(1);
  }

  printResult("PASS", [
    `runId: ${result.runId}`,
    `runType: ${result.runType}`,
    `imported: ${result.imported}`,
    `updated: ${result.updated}`,
    `signalsReceived: ${result.signalsReceived}`
  ]);
  process.exit(hasAttribution(result) ? 0 : 1);
} catch (error) {
  printResult("FAIL", [`error: ${error.message}`, `baseUrl: ${baseUrl}`]);
  process.exit(1);
}
