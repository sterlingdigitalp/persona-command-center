import { readFile, rm } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const dbPath = path.join(rootDir, "work", "verify-editorial-intelligence-import.sqlite");
const checks = [];

function addCheck(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}

process.env.DB_PATH = dbPath;
process.env.DISABLE_HERMES_BOOTSTRAP = "1";
await rm(dbPath, { force: true });

const db = await import("../src/db.js");
const server = await import("../src/server.js");
const { importHermesPayload } = await import("../src/hermes/hermesImport.js");

try {
  await db.initDb();
  const generatedAt = new Date().toISOString();
  const payload = {
    runType: "morning_digest",
    generatedAt,
    provider: "SearchAgent",
    model: "editorial-intelligence-v1",
    endpoint: "search_agent://editorial-intelligence",
    jobName: "persona-command-center-editorial-intelligence",
    personas: [{
      personaId: "policy-pete",
      signals: [{
        topic: "AI policy moves from tooling into school norms",
        source: "hermes_x_search",
        query: "AI use in schools policy",
        sourceProvider: "SearchAgent",
        firstSeenAt: generatedAt,
        lastSeenAt: generatedAt,
        velocityScore: 72,
        relevanceScore: 91,
        noveltyScore: 78,
        freshnessScore: 94,
        riskScore: 14,
        priorityScore: 88,
        sourceCount: 3,
        clusterId: "editorial-intelligence-good",
        suggestedAngle: "AI adoption is becoming an implementation reality for school systems.",
        evidenceUrls: ["https://x.com/paulg/status/1234567890"],
        conversationContext: "The conversation is shifting from novelty to school policy and classroom practice.",
        whyPeopleCare: "Parents, teachers, and administrators need a practical frame for what changes next.",
        tensionOrContradiction: "Schools discourage shortcuts while adopting AI workflows themselves.",
        surprisingAngle: "The real story is implementation, not whether the tool is impressive.",
        personaEntryPoint: "PolicyPete can explain the practical consequences without hype.",
        draftStrategy: "Lead with implementation reality and budget consequences.",
        qualityScore: 92,
        qualityWarnings: ["Verify district-level examples before manual publishing."],
        rawData: { retrievalStatus: "success", entityName: "Paul Graham" }
      }]
    }, {
      personaId: "the-wonkette",
      signals: [{
        topic: "template: write a post about agency leadership",
        source: "rss",
        query: "agency leadership",
        sourceProvider: "rss",
        firstSeenAt: generatedAt,
        lastSeenAt: generatedAt,
        velocityScore: 55,
        relevanceScore: 75,
        noveltyScore: 62,
        freshnessScore: 80,
        riskScore: 18,
        priorityScore: 61,
        sourceCount: 1,
        clusterId: "editorial-intelligence-banned",
        suggestedAngle: "Avoid template language and rewrite before review.",
        evidenceUrls: ["https://example.org/agency-leadership"],
        draftStrategy: "template: write a post in the house voice",
        qualityScore: 35,
        qualityWarnings: ["Template phrase must be rewritten."],
        rawData: { retrievalStatus: "success" }
      }]
    }]
  };

  const importResult = await importHermesPayload(payload);
  addCheck("Hermes-style payload with editorial metadata imports successfully", importResult.importedSignalIds.length === 2, JSON.stringify(importResult));

  const rows = await db.querySql(`
    SELECT id, persona_id, editorial_metadata
    FROM signals
    WHERE id IN (${importResult.importedSignalIds.map(db.sqlString).join(",")})
    ORDER BY persona_id;
  `);
  const metadataByPersona = new Map(rows.map((row) => [row.persona_id, db.parseJsonField(row.editorial_metadata, {})]));
  addCheck("signal editorial metadata survives round trip", metadataByPersona.get("policy-pete")?.whyPeopleCare?.includes("Parents") && metadataByPersona.get("policy-pete")?.draftStrategy?.includes("implementation"), JSON.stringify(Object.fromEntries(metadataByPersona)));

  const goodSignalId = rows.find((row) => row.persona_id === "policy-pete")?.id;
  const goodDrafts = await server.generateDrafts({ personaId: "policy-pete", signalIds: [goodSignalId], count: 3 });
  addCheck("3 drafts persist from editorial signal", goodDrafts.length === 3, String(goodDrafts.length));
  addCheck("draft editorial metadata survives round trip", goodDrafts.every((draft) => draft.editorialMetadata?.whyPeopleCare?.includes("Parents") && draft.editorialMetadata?.qualityWarnings?.length), JSON.stringify(goodDrafts.map((draft) => draft.editorialMetadata)));

  const badSignalId = rows.find((row) => row.persona_id === "the-wonkette")?.id;
  const badDrafts = await server.generateDrafts({ personaId: "the-wonkette", signalIds: [badSignalId], count: 2 });
  addCheck("banned phrases are downgraded out of Ready", badDrafts.every((draft) => draft.status === "needs_edit" && draft.qualityChecks?.passed === false), JSON.stringify(badDrafts.map((draft) => ({ status: draft.status, qualityChecks: draft.qualityChecks }))));

  const html = await readFile(path.join(rootDir, "outputs", "persona-command-center.html"), "utf8");
  addCheck("Queue displays collapsed editorial detail", html.includes("function draftEditorialDetailsHtml(draft)") && html.includes("Why this works"));
  addCheck("Operator/Queue selection still caps clean draft cards", html.includes("selectQueueDrafts(drafts, { focusDraftId: queueFocusDraftId })") && html.includes(".slice(0, 3)") && html.includes("return selected.slice(0, 12);"));
} catch (error) {
  addCheck("editorial intelligence verification ran", false, error.stack || error.message);
} finally {
  await rm(dbPath, { force: true });
}

const failed = checks.filter((check) => !check.ok);
console.log(failed.length ? "FAIL editorial intelligence import verification" : "PASS editorial intelligence import verification");
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
process.exit(failed.length ? 1 : 0);
