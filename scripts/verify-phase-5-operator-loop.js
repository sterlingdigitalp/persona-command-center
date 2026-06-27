#!/usr/bin/env node
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const dbPath = process.env.DB_PATH || path.join(rootDir, "work", "phase5-operator-loop.sqlite");
const port = Number(process.env.PCC_PHASE5_PORT || 3325);
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

async function expectFailure(name, pathname, options = {}, expectedText = "") {
  try {
    await api(pathname, options);
    addCheck(name, false, "request unexpectedly succeeded");
  } catch (error) {
    const ok = !expectedText || error.message.includes(expectedText);
    addCheck(name, ok, error.message);
  }
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
  const persona = personas.find((item) => item.id === "policy-pete") || personas[0];
  if (!persona) throw new Error("No persona available for Phase 5 verification");
  addCheck("personas available", Boolean(persona), persona.id);

  const generatedAt = new Date().toISOString();
  const importResult = await api("/api/hermes/import", {
    method: "POST",
    body: JSON.stringify({
      version: "2026-06-phase5",
      runType: "morning_digest",
      provider: "local-verifier",
      model: "no-x-api",
      endpoint: "local-only",
      jobName: "phase5-operator-loop",
      generatedAt,
      personas: [{
        personaId: persona.id,
        signals: [{
          topic: "Phase 5 local operator loop signal",
          source: "Verifier",
          query: "phase 5 operator loop",
          firstSeenAt: generatedAt,
          lastSeenAt: generatedAt,
          velocityScore: 78,
          relevanceScore: 85,
          noveltyScore: 88,
          freshnessScore: 96,
          priorityScore: 91,
          riskScore: 8,
          sourceCount: 4,
          clusterId: `phase5-operator-loop-${Date.now()}`,
          suggestedAngle: `${persona.name}: explain why local review beats premature automation.`,
          evidenceUrls: ["https://example.com/phase5-local-loop"]
        }]
      }]
    })
  });
  const signalId = importResult.importedSignalIds[0];
  addCheck("Hermes import created local signal", Boolean(signalId), signalId);

  const foreignPersona = personas.find((item) => item.id !== persona.id);
  if (foreignPersona) {
    await expectFailure(
      "cross-persona draft generation is rejected",
      "/api/drafts/generate",
      {
        method: "POST",
        body: JSON.stringify({ personaId: foreignPersona.id, signalIds: [signalId], count: 2 })
      },
      "signalIds must exist and belong"
    );
  }

  const reviewedSignal = await api(`/api/signals/${signalId}/mark-reviewed`, {
    method: "POST",
    body: JSON.stringify({ reason: "Relevant to local no-X-API operator loop." })
  });
  addCheck("signal review reason saved", reviewedSignal.reviewReason === "Relevant to local no-X-API operator loop.", reviewedSignal.reviewReason || "missing");

  const signalHistoryBeforeDraft = await api(`/api/signals/${signalId}/history`);
  addCheck("signal history is available before drafting", signalHistoryBeforeDraft.snapshots.length >= 1, `${signalHistoryBeforeDraft.snapshots.length} snapshots`);

  const drafts = await api("/api/drafts/generate", {
    method: "POST",
    body: JSON.stringify({ personaId: persona.id, signalIds: [signalId], count: 2 })
  });
  addCheck("drafts generated", drafts.length >= 2, String(drafts.length));
  addCheck("draft quality checks returned", drafts.every((draft) => draft.qualityChecks?.platform === "x"), JSON.stringify(drafts[0]?.qualityChecks || {}));

  const abChoice = await api("/api/operator/draft-choices", {
    method: "POST",
    body: JSON.stringify({
      personaId: persona.id,
      signalId,
      sourceSignalIds: [signalId],
      draftA: drafts[0].body,
      draftB: drafts[1].body,
      selectedVariant: "B",
      editedFinalText: drafts[1].body,
      choiceReason: "Variant B has the cleaner manual-post hook.",
      outcome: "recorded"
    })
  });
  addCheck("A/B draft choice recorded", abChoice.selectedVariant === "B" && abChoice.draftA && abChoice.draftB, JSON.stringify({
    selectedVariant: abChoice.selectedVariant,
    hasDraftA: Boolean(abChoice.draftA),
    hasDraftB: Boolean(abChoice.draftB)
  }));

  await expectFailure(
    "invalid A/B draft choice variant is rejected",
    "/api/operator/draft-choices",
    {
      method: "POST",
      body: JSON.stringify({
        personaId: persona.id,
        signalId,
        draftA: drafts[0].body,
        selectedVariant: "C",
        editedFinalText: drafts[0].body
      })
    },
    "selectedVariant"
  );

  const rejectedDraft = await api(`/api/drafts/${drafts[0].id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason: "Needs a sharper hook before use." })
  });
  addCheck("draft rejection reason saved", rejectedDraft.rejectionReason === "Needs a sharper hook before use.", rejectedDraft.rejectionReason || "missing");

  await expectFailure(
    "rejected drafts cannot be scheduled",
    "/api/schedule",
    {
      method: "POST",
      body: JSON.stringify({ draftId: rejectedDraft.id })
    },
    "Only approved drafts"
  );

  const approvedDraft = await api(`/api/drafts/${drafts[1].id}/approve`, {
    method: "POST",
    body: JSON.stringify({ reason: "Approved for manual scheduling." })
  });
  addCheck("draft approval reason saved", approvedDraft.reviewReason === "Approved for manual scheduling.", approvedDraft.reviewReason || "missing");
  addCheck("approved draft has X quality result", approvedDraft.qualityChecks?.passed === true, JSON.stringify(approvedDraft.qualityChecks || {}));

  const oversizedDraft = await api(`/api/drafts/${approvedDraft.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      editedBody: `${approvedDraft.body} ${"extra context ".repeat(30)}`
    })
  });
  addCheck("X quality check catches over-limit drafts", oversizedDraft.qualityChecks?.passed === false && oversizedDraft.qualityChecks?.withinLimit === false, JSON.stringify(oversizedDraft.qualityChecks || {}));

  const restoredApprovedDraft = await api(`/api/drafts/${approvedDraft.id}`, {
    method: "PATCH",
    body: JSON.stringify({ editedBody: approvedDraft.body })
  });
  addCheck("X quality check recovers after edit", restoredApprovedDraft.qualityChecks?.passed === true, JSON.stringify(restoredApprovedDraft.qualityChecks || {}));

  const scheduled = await api("/api/schedule", {
    method: "POST",
    body: JSON.stringify({
      draftId: approvedDraft.id,
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })
  });
  addCheck("scheduled post created", scheduled.status === "scheduled", scheduled.id);

  const scheduledChoice = await api(`/api/operator/draft-choices/${abChoice.id}/outcome`, {
    method: "PATCH",
    body: JSON.stringify({
      outcome: "scheduled",
      scheduledPostId: scheduled.id,
      editedFinalText: restoredApprovedDraft.body
    })
  });
  addCheck("A/B draft choice linked to scheduled outcome", scheduledChoice.outcome === "scheduled" && scheduledChoice.scheduledPostId === scheduled.id, JSON.stringify({
    outcome: scheduledChoice.outcome,
    scheduledPostId: scheduledChoice.scheduledPostId
  }));

  const published = await api(`/api/schedule/${scheduled.id}/mark-published`, {
    method: "POST",
    body: JSON.stringify({
      publishedUrl: "https://x.local/manual/phase5",
      publishedAt: new Date().toISOString(),
      engagementNotes: "Manual publish confirmation; no X API call made."
    })
  });
  addCheck("manual published post created", published.status === "published_manual", published.id);
  addCheck("published post linked to schedule", published.scheduledPostId === scheduled.id, published.scheduledPostId || "missing");

  const publishedChoice = await api(`/api/operator/draft-choices/${abChoice.id}/outcome`, {
    method: "PATCH",
    body: JSON.stringify({
      outcome: "published",
      scheduledPostId: scheduled.id,
      publishedPostId: published.id,
      editedFinalText: restoredApprovedDraft.body
    })
  });
  addCheck("A/B draft choice linked to published outcome", publishedChoice.outcome === "published" && publishedChoice.publishedPostId === published.id, JSON.stringify({
    outcome: publishedChoice.outcome,
    publishedPostId: publishedChoice.publishedPostId
  }));

  const repeatedPublish = await api(`/api/schedule/${scheduled.id}/mark-published`, {
    method: "POST",
    body: JSON.stringify({ publishedUrl: "https://x.local/manual/phase5-repeat" })
  });
  addCheck("manual publish is idempotent", repeatedPublish.id === published.id, repeatedPublish.id);

  const updatedPerformance = await api(`/api/published-posts/${published.id}/performance`, {
    method: "PATCH",
    body: JSON.stringify({
      impressions: 1200,
      likes: 84,
      reposts: 11,
      replies: 5,
      bookmarks: 17,
      notes: "Manual metrics entered from X UI."
    })
  });
  addCheck("manual performance captured", updatedPerformance.performance.impressions === 1200 && updatedPerformance.performance.likes === 84, JSON.stringify(updatedPerformance.performance));

  await expectFailure(
    "invalid performance metrics are rejected",
    `/api/published-posts/${published.id}/performance`,
    {
      method: "PATCH",
      body: JSON.stringify({ impressions: -1 })
    },
    "non-negative"
  );

  const signalHistoryAfterPublish = await api(`/api/signals/${signalId}/history`);
  addCheck(
    "signal memory remains linked after publish",
    signalHistoryAfterPublish.signal.status === "used" && signalHistoryAfterPublish.signal.usedAt,
    `${signalHistoryAfterPublish.signal.status} ${signalHistoryAfterPublish.signal.usedAt || ""}`.trim()
  );

  const schedule = await api("/api/schedule");
  addCheck("scheduled post marked published", schedule.some((post) => post.id === scheduled.id && post.status === "published"), scheduled.id);

  const publishedPosts = await api(`/api/published-posts?personaId=${encodeURIComponent(persona.id)}`);
  addCheck("published posts endpoint returns ledger", publishedPosts.some((post) => post.id === published.id), `${publishedPosts.length} posts`);
  const draftChoices = await api(`/api/operator/draft-choices?personaId=${encodeURIComponent(persona.id)}`);
  addCheck("A/B draft choice endpoint returns learning ledger", draftChoices.some((choice) => choice.id === abChoice.id && choice.selectedVariant === "B" && choice.outcome === "published"), `${draftChoices.length} choices`);
  const publishedLedger = publishedPosts.find((post) => post.id === published.id);
  addCheck(
    "published ledger persists manual fields",
    Boolean(publishedLedger?.publishedUrl && publishedLedger?.publishedAt && publishedLedger?.personaId === persona.id && publishedLedger?.body),
    JSON.stringify({
      publishedUrl: publishedLedger?.publishedUrl,
      publishedAt: publishedLedger?.publishedAt,
      personaId: publishedLedger?.personaId,
      hasBody: Boolean(publishedLedger?.body)
    })
  );

  const extraDrafts = await api("/api/drafts/generate", {
    method: "POST",
    body: JSON.stringify({ personaId: persona.id, signalIds: [signalId], count: 2 })
  });
  const extraApproved = await api(`/api/drafts/${extraDrafts[0].id}/approve`, {
    method: "POST",
    body: JSON.stringify({ reason: "Approved to test cancellation gate." })
  });
  const scheduledThenCancelled = await api("/api/schedule", {
    method: "POST",
    body: JSON.stringify({ draftId: extraApproved.id })
  });
  await api(`/api/schedule/${scheduledThenCancelled.id}/cancel`, { method: "POST" });
  await expectFailure(
    "cancelled scheduled posts cannot be published",
    `/api/schedule/${scheduledThenCancelled.id}/mark-published`,
    { method: "POST", body: JSON.stringify({}) },
    "Only scheduled posts"
  );

  const queue = await api("/api/operator/queue");
  const personaQueue = queue.personas.find((item) => item.persona.id === persona.id);
  addCheck("operator queue is local-only", queue.noExternalPublishing === true && queue.xCredentialsRequired === false, JSON.stringify({
    noExternalPublishing: queue.noExternalPublishing,
    xCredentialsRequired: queue.xCredentialsRequired
  }));
  addCheck("operator queue includes signal/draft/schedule/published", Boolean(
    personaQueue
      && personaQueue.drafts.some((draft) => draft.id === approvedDraft.id)
      && personaQueue.scheduledPosts.some((post) => post.id === scheduled.id)
      && personaQueue.publishedPosts.some((post) => post.id === published.id && post.sourceSignalIds.includes(signalId))
      && personaQueue.draftChoices.some((choice) => choice.id === abChoice.id && choice.selectedVariant === "B")
  ), personaQueue?.persona?.id || "missing");
  addCheck("used signal is not open queue work", !personaQueue?.signals.some((signal) => signal.id === signalId), `${personaQueue?.signals.length || 0} open signals`);

  const audit = await api("/api/audit-log?limit=100");
  addCheck("phase 5 audit events recorded", audit.some((event) => event.action === "published_post.created") && audit.some((event) => event.action === "published_post.performance_updated") && audit.some((event) => event.action === "operator_draft_choice.created"), audit.slice(0, 8).map((event) => event.action).join(", "));
} catch (error) {
  report.pass = false;
  report.errors.push(error.message);
} finally {
  if (child) child.kill("SIGTERM");
}

console.log(report.pass ? "PASS Phase 5 operator loop verification" : "FAIL Phase 5 operator loop verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
for (const error of report.errors) console.log(`ERROR - ${error}`);
process.exit(report.pass ? 0 : 1);
