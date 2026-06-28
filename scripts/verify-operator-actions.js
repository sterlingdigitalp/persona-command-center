import { readFile, rm } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const dbPath = path.join(rootDir, "work", "verify-operator-actions.sqlite");
const checks = [];

function addCheck(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}

process.env.DB_PATH = dbPath;
process.env.DISABLE_HERMES_BOOTSTRAP = "1";
await rm(dbPath, { force: true });

const db = await import("../src/db.js");
const server = await import("../src/server.js");

async function createChoice(personaId, draft, outcome = "recorded") {
  return server.createOperatorDraftChoice({
    personaId,
    sourceSignalIds: draft.sourceSignalIds || [],
    draftA: draft.editedBody || draft.body,
    draftB: null,
    selectedVariant: "A",
    choiceReason: "Operator action verification",
    outcome
  });
}

try {
  await db.initDb();
  const html = await readFile(path.join(rootDir, "outputs", "persona-command-center.html"), "utf8");
  addCheck("Operator action text falls back to existing draft body", html.includes("function operatorActionText(personaId, ref = \"\")") && html.includes("draftTextForRef(ref, personaId)"));
  addCheck("Operator Edit keeps exact Queue draft target", html.includes("function openQueueForDraft(draftId)") && html.includes("data-draft-id"));

  const personas = await server.getPersonas({ includeInactiveQueries: true });
  addCheck("loaded four personas", personas.length === 4, String(personas.length));

  const beforeQueue = await server.getOperatorQueue();
  const beforePublished = new Map((beforeQueue.personas || []).map((item) => [item.persona.id, Number(item.summary?.publishedCount || 0)]));
  const actionResults = [];

  for (const persona of personas) {
    const generated = await server.generateDrafts({ personaId: persona.id, count: 3 });
    const [sendDraft, laterDraft, skipDraft] = generated;

    const sendChoice = await createChoice(persona.id, sendDraft);
    const approvedSend = await server.setDraftStatus(sendDraft.id, "approved", { reason: "Operator send verification" });
    const scheduledSend = await server.createScheduledPost({ draftId: approvedSend.id });
    const published = await server.markScheduledPostPublished(scheduledSend.id, {
      publishedUrl: "",
      engagementNotes: "Marked sent manually by operator verification."
    });
    const publishedChoice = await server.updateOperatorDraftChoiceOutcome(sendChoice.id, {
      outcome: "published",
      scheduledPostId: scheduledSend.id,
      publishedPostId: published.id
    });
    actionResults.push({ personaId: persona.id, action: "send", draftId: sendDraft.id, choice: publishedChoice, published });

    const laterChoice = await createChoice(persona.id, laterDraft);
    const approvedLater = await server.setDraftStatus(laterDraft.id, "approved", { reason: "Operator later verification" });
    const scheduledLater = await server.createScheduledPost({
      draftId: approvedLater.id,
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    const scheduledChoice = await server.updateOperatorDraftChoiceOutcome(laterChoice.id, {
      outcome: "scheduled",
      scheduledPostId: scheduledLater.id
    });
    actionResults.push({ personaId: persona.id, action: "later", draftId: laterDraft.id, choice: scheduledChoice, scheduled: scheduledLater });

    await server.setDraftStatus(skipDraft.id, "rejected", { reason: "Operator skip verification" });
    const skippedChoice = await createChoice(persona.id, skipDraft, "skipped");
    actionResults.push({ personaId: persona.id, action: "skip", draftId: skipDraft.id, choice: skippedChoice });
  }

  const sendResults = actionResults.filter((result) => result.action === "send");
  const laterResults = actionResults.filter((result) => result.action === "later");
  const skipResults = actionResults.filter((result) => result.action === "skip");

  addCheck("Send succeeds for all personas without editedFinalText", sendResults.length === personas.length && sendResults.every((result) => result.choice.outcome === "published"), JSON.stringify(sendResults.map((result) => result.personaId)));
  addCheck("Later succeeds for all personas without editedFinalText", laterResults.length === personas.length && laterResults.every((result) => result.choice.outcome === "scheduled"), JSON.stringify(laterResults.map((result) => result.personaId)));
  addCheck("Skip succeeds for all personas without editedFinalText", skipResults.length === personas.length && skipResults.every((result) => result.choice.outcome === "skipped"), JSON.stringify(skipResults.map((result) => result.personaId)));
  addCheck("No external X publishing call/ID recorded", sendResults.every((result) => result.published.status === "published_manual" && !result.published.externalPostId), JSON.stringify(sendResults.map((result) => ({ personaId: result.personaId, status: result.published.status, externalPostId: result.published.externalPostId }))));

  const afterQueue = await server.getOperatorQueue();
  const afterPublished = new Map((afterQueue.personas || []).map((item) => [item.persona.id, Number(item.summary?.publishedCount || 0)]));
  addCheck("Sent count increases after Send for all personas", personas.every((persona) => (afterPublished.get(persona.id) || 0) > (beforePublished.get(persona.id) || 0)), JSON.stringify(Object.fromEntries(afterPublished)));

  const queueDrafts = (afterQueue.personas || []).flatMap((item) => (item.drafts || []).map((draft) => ({ ...draft, personaId: item.persona.id })));
  const visiblePersonaIds = new Set(queueDrafts.map((draft) => draft.personaId));
  addCheck("Queue contains drafts for all four personas", personas.every((persona) => visiblePersonaIds.has(persona.id)), JSON.stringify([...visiblePersonaIds]));
  addCheck("Queue can resolve every Later/Edit target", laterResults.every((result) => queueDrafts.some((draft) => draft.id === result.draftId)), JSON.stringify(laterResults.map((result) => result.draftId)));
} catch (error) {
  addCheck("operator action verification ran", false, error.stack || error.message);
} finally {
  await rm(dbPath, { force: true });
}

const failed = checks.filter((check) => !check.ok);
console.log(failed.length ? "FAIL operator actions verification" : "PASS operator actions verification");
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
process.exit(failed.length ? 1 : 0);
