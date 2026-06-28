#!/usr/bin/env node
const baseUrl = (process.env.PCC_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const report = { pass: true, checks: [] };
const legacyNames = ["The Wonkette", "PolicyPete", "MAGA Memester", "ProgressivePat"];

function addCheck(name, ok, detail = "") {
  report.checks.push({ name, ok, detail });
  if (!ok) report.pass = false;
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(json.error || text || `${path} ${response.status}`);
  return json;
}

try {
  const beforeDrafts = await api("/api/drafts");
  const generatedAt = new Date().toISOString();
  const nonce = Date.now();
  const topic = `Paul Graham comments on AI use in schools ${nonce}`;
  const payload = {
    runType: "morning_digest",
    generatedAt,
    provider: "SearchAgent",
    model: "search_agent_v1",
    endpoint: "search_agent://x_search/production-draft-check",
    jobName: "hermes-watch-list-bridge-morning_digest",
    personas: [{
      personaId: "policy-pete",
      signals: [{
        topic,
        source: "hermes_x_search",
        query: "Watch List: Paul Graham (@paulg)",
        sourceProvider: "SearchAgent",
        sourceCount: 2,
        firstSeenAt: generatedAt,
        lastSeenAt: generatedAt,
        velocityScore: 62,
        relevanceScore: 86,
        noveltyScore: 78,
        freshnessScore: 91,
        riskScore: 12,
        priorityScore: 84,
        suggestedAngle: "AI adoption is moving from tooling into education norms",
        evidenceUrls: ["https://x.com/paulg/status/1234567890"],
        clusterId: `production-drafts-${nonce}`,
        rawData: { retrievalStatus: "success", entityName: "Paul Graham", handle: "@paulg" }
      }]
    }]
  };
  const result = await api("/api/hermes/import", { method: "POST", body: JSON.stringify(payload) });
  const afterDrafts = await api("/api/drafts");
  const queue = await api("/api/operator/queue");
  const queueDrafts = (queue.personas || []).flatMap((item) => item.drafts || []);
  const readyPosts = queueDrafts.filter((draft) => ["needs_review", "approved"].includes(draft.status));
  const newDrafts = afterDrafts.filter((draft) => !beforeDrafts.some((existing) => existing.id === draft.id));
  const text = newDrafts.map((draft) => draft.body).join("\n");

  addCheck("production import accepted", Boolean(result.runId), result.runId || "no runId");
  addCheck("production import generated exactly 3 drafts", result.draftsGenerated === 3 && newDrafts.length >= 3, `result=${result.draftsGenerated}, new=${newDrafts.length}`);
  addCheck("Ready Posts > 0", readyPosts.length > 0, `${readyPosts.length} ready posts`);
  addCheck("drafts are publish-ready text", newDrafts.slice(0, 3).every((draft) => draft.qualityChecks?.passed && !/frame \"|write|draft a|template/i.test(draft.body)), text);
  addCheck("legacy persona labels absent", !legacyNames.some((name) => text.includes(name)), text);
} catch (error) {
  addCheck("production draft verification ran", false, error.message);
}

console.log(report.pass ? "PASS production drafts verification" : "FAIL production drafts verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
process.exit(report.pass ? 0 : 1);
