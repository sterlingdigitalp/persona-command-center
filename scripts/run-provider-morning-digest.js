#!/usr/bin/env node
const baseUrl = (process.env.PCC_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

function hasAttribution(result) {
  return Boolean(result?.attribution?.provider && result?.attribution?.model && result?.attribution?.endpoint && result?.attribution?.jobName);
}

function printResult(status, lines = []) {
  console.log(`${status} provider-backed Hermes morning digest`);
  for (const line of lines) console.log(line);
}

try {
  const body = {
    provider: process.env.HERMES_PROVIDER || "lmstudio",
    model: process.env.HERMES_MODEL || "qwen3.6-35b-a3b-mtp",
    endpoint: process.env.HERMES_ENDPOINT || "http://localhost:1234/v1",
    jobName: process.env.HERMES_JOB_NAME || "persona-command-center-morning-digest",
    maxSignalsPerPersona: Number(process.env.HERMES_MAX_SIGNALS_PER_PERSONA || 3),
    providers: (process.env.HERMES_DIGEST_PROVIDERS || "rss,news").split(",").map((item) => item.trim()).filter(Boolean)
  };

  const response = await fetch(`${baseUrl}/api/hermes/morning-digest/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    printResult("FAIL", [`status: ${response.status}`, `error: ${result.error || JSON.stringify(result)}`]);
    process.exit(1);
  }

  const personaLines = (result.topSignalsByPersona || []).map((persona) => (
    `${persona.personaId}: ${persona.signalCount} signals`
  ));
  printResult("PASS", [
    `runId: ${result.runId}`,
    `candidateCount: ${result.candidateCount}`,
    `freshCandidateCount: ${result.freshCandidateCount}`,
    `staleFilteredCount: ${result.staleFilteredCount}`,
    `mockFilteredCount: ${result.mockFilteredCount}`,
    `missingDateFilteredCount: ${result.missingDateFilteredCount}`,
    `signalCount: ${result.signalCount}`,
    `attribution: ${hasAttribution(result) ? "complete" : "missing"}`,
    ...personaLines
  ]);
  process.exit(hasAttribution(result) ? 0 : 1);
} catch (error) {
  printResult("FAIL", [`error: ${error.message}`, `baseUrl: ${baseUrl}`]);
  process.exit(1);
}
