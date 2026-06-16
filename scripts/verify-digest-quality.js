#!/usr/bin/env node
const baseUrl = (process.env.PCC_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const maxAgeHours = Number(process.env.DIGEST_MAX_AGE_HOURS || 72);
const staleMarkers = [
  /\b2024\b/i,
  /\b2025\b/i,
  /\blast year\b/i,
  /\byears ago\b/i,
  /\barchive\b/i,
  /\bupdated:/i,
  /\boriginally published\b/i,
  /\bfirst published\b/i,
  /\brevised\b/i,
  /\bcorrection\b/i,
  /\bfrom the archive\b/i
];
const blockedSources = ["mock-public-news.example", "mock-rss-feed.example", "example.test", "hermes.local"];
const report = { pass: true, checks: [], errors: [] };

function addCheck(name, ok, detail = "") {
  report.checks.push({ name, ok, detail });
  if (!ok) report.pass = false;
}

function allSignals(digest) {
  return (digest.topSignalsByPersona || []).flatMap((persona) => persona.signals || []);
}

function signalDate(signal) {
  const value = signal.publishedAt || signal.firstSeenAt;
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date;
}

try {
  const response = await fetch(`${baseUrl}/api/hermes/morning-digest/latest?compact=true`);
  if (!response.ok) throw new Error(`/api/hermes/morning-digest/latest?compact=true returned ${response.status}`);
  const digest = await response.json();
  const signals = allSignals(digest);
  const now = new Date();

  addCheck("providerNames exclude mock", !(digest.providerNames || []).includes("mock"), (digest.providerNames || []).join(", ") || "-");
  for (const source of blockedSources) {
    addCheck(
      `no ${source}`,
      !signals.some((signal) => String(signal.source || "").includes(source) || (signal.evidenceUrls || []).some((url) => String(url).includes(source))),
      `${signals.length} signals checked`
    );
  }
  addCheck("signalCount > 0", Number(digest.signalCount || 0) > 0, String(digest.signalCount || 0));
  addCheck("freshCandidateCount present", Number(digest.freshCandidateCount || 0) >= Number(digest.signalCount || 0), String(digest.freshCandidateCount || 0));
  addCheck(
    "all selected signals are within 72 hours",
    signals.every((signal) => {
      const date = signalDate(signal);
      if (!date) return false;
      const ageHours = (now.getTime() - date.getTime()) / 36e5;
      return ageHours >= -2 && ageHours <= maxAgeHours;
    }),
    `${signals.length} signals checked`
  );
  addCheck(
    "no stale title markers",
    signals.every((signal) => !staleMarkers.some((marker) => marker.test(String(signal.topic || "")))),
    `${signals.length} signals checked`
  );
} catch (error) {
  report.pass = false;
  report.errors.push(error.message);
}

console.log(report.pass ? "PASS digest quality verification" : "FAIL digest quality verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
for (const error of report.errors) {
  console.log(`ERROR - ${error}`);
}

process.exit(report.pass ? 0 : 1);
