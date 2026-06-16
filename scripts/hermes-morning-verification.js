#!/usr/bin/env node
const baseUrl = (process.env.PCC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

const report = {
  pass: true,
  checks: [],
  errors: []
};

function addCheck(name, ok, detail = "") {
  report.checks.push({ name, ok, detail });
  if (!ok) report.pass = false;
}

function hasAttribution(signal) {
  return Boolean(signal?.hermesProvider && signal?.hermesModel && signal?.hermesEndpoint && signal?.hermesJobName);
}

function newestSignal(signals, predicate) {
  return signals
    .filter(predicate)
    .sort((a, b) => new Date(b.lastSeenAt || b.firstSeenAt || 0) - new Date(a.lastSeenAt || a.firstSeenAt || 0))[0];
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

try {
  const health = await getJson("/api/health");
  addCheck("backend health", health.ok === true, `phase ${health.phase}`);

  const hermesHealth = await getJson("/api/hermes/health");
  addCheck("Hermes health reachable", true, hermesHealth.lastValidationStatus || "no validation status");
  addCheck("no Hermes health errors", !hermesHealth.lastHermesRun?.errorMessage, hermesHealth.lastHermesRun?.errorMessage || "none");

  const todaySignals = await getJson("/api/signals/today");
  addCheck("today signals reachable", Array.isArray(todaySignals), `${todaySignals.length} signals`);

  const audit = await getJson("/api/audit-log?limit=50");
  addCheck(
    "recent Hermes audit events",
    audit.some((event) => String(event.action).startsWith("hermes")),
    `${audit.filter((event) => String(event.action).startsWith("hermes")).length} Hermes events`
  );

  const allSignals = await getJson("/api/signals?includeDismissed=true&limit=200");
  const validationSignal = newestSignal(allSignals, (signal) => signal.validationId || signal.hermesRunType === "validation_ping");
  addCheck("last validation run exists", Boolean(hermesHealth.lastValidationRun || validationSignal), validationSignal?.validationId || "not observed");
  if (validationSignal) {
    addCheck("validation attribution", hasAttribution(validationSignal), `${validationSignal.hermesProvider || "-"} / ${validationSignal.hermesModel || "-"}`);
  }

  const morningSignal = newestSignal(allSignals, (signal) => signal.hermesRunType === "morning_digest");
  if (!morningSignal) {
    report.checks.push({ name: "morning digest signal", ok: true, detail: "Morning digest not yet observed" });
  } else {
    addCheck("morning digest signal exists", true, morningSignal.topic);
    addCheck("morning digest attribution", hasAttribution(morningSignal), `${morningSignal.hermesProvider || "-"} / ${morningSignal.hermesModel || "-"}`);
  }
} catch (error) {
  report.pass = false;
  report.errors.push(error.message);
}

console.log(report.pass ? "PASS Hermes morning verification" : "FAIL Hermes morning verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
for (const error of report.errors) {
  console.log(`ERROR - ${error}`);
}

process.exit(report.pass ? 0 : 1);
