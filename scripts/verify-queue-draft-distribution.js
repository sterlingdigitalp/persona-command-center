import { readFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const html = await readFile(path.join(rootDir, "outputs", "persona-command-center.html"), "utf8");
const checks = [];

function addCheck(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}

const personas = [
  { id: "the-wonkette", name: "Peptide Tracker" },
  { id: "policy-pete", name: "Sterling Digital" },
  { id: "maga-memester", name: "Scott Decoded" },
  { id: "progressive-pat", name: "Chris Klebl" }
];

function selectQueueDrafts(allDrafts, { focusDraftId = null } = {}) {
  const reviewReadyStatuses = new Set(["needs_review", "approved", "scheduled"]);
  const eligible = (allDrafts || []).filter((draft) => reviewReadyStatuses.has(draft.status));
  const personaOrder = personas.length
    ? personas.map((persona) => persona.id)
    : [...new Set(eligible.map((draft) => draft.personaId).filter(Boolean))];
  const knownPersonaIds = new Set(personaOrder);
  for (const draft of eligible) {
    if (draft.personaId && !knownPersonaIds.has(draft.personaId)) {
      personaOrder.push(draft.personaId);
      knownPersonaIds.add(draft.personaId);
    }
  }
  const priorityFor = (draft) => {
    const quality = draft.qualityChecks || {};
    return Number(draft.priorityScore ?? draft.priority ?? quality.priorityScore ?? quality.score ?? 0);
  };
  const dateFor = (draft) => Date.parse(draft.updatedAt || draft.createdAt || "") || 0;
  const sortedForPersona = (personaId) => eligible
    .filter((draft) => draft.personaId === personaId)
    .sort((a, b) => priorityFor(b) - priorityFor(a) || dateFor(b) - dateFor(a));
  const selected = personaOrder.flatMap((personaId) => sortedForPersona(personaId).slice(0, 3));
  const selectedIds = new Set(selected.map((draft) => draft.id));
  const focusDraft = focusDraftId
    ? eligible.find((draft) => draft.id === focusDraftId)
    : null;
  if (focusDraft && !selectedIds.has(focusDraft.id)) {
    return [focusDraft, ...selected];
  }
  if (focusDraft) {
    return [...selected].sort((a, b) => {
      if (a.id === focusDraft.id) return -1;
      if (b.id === focusDraft.id) return 1;
      return 0;
    });
  }
  return selected.slice(0, 12);
}

function draft(id, personaId, index, overrides = {}) {
  return {
    id,
    personaId,
    status: "needs_review",
    body: `${personaId} draft ${index}`,
    qualityChecks: { score: 50 + index },
    updatedAt: new Date(Date.UTC(2026, 5, 28, 12, index)).toISOString(),
    ...overrides
  };
}

const drafts = [];
for (const persona of personas) {
  for (let index = 0; index < 6; index += 1) {
    drafts.push(draft(`draft_${persona.id}_${index}`, persona.id, index));
  }
}
drafts.push(
  draft("draft_rejected_hidden", personas[0].id, 99, { status: "rejected", qualityChecks: { score: 999 } }),
  draft("draft_skipped_hidden", personas[1].id, 99, { status: "skipped", qualityChecks: { score: 999 } }),
  draft("draft_published_hidden", personas[2].id, 99, { status: "published", qualityChecks: { score: 999 } })
);

const selected = selectQueueDrafts(drafts);
const selectedIds = new Set(selected.map((item) => item.id));
const counts = selected.reduce((acc, item) => {
  acc[item.personaId] = (acc[item.personaId] || 0) + 1;
  return acc;
}, {});

addCheck("frontend uses selectQueueDrafts for Draft Review", html.includes("const visibleDrafts = selectQueueDrafts(drafts, { focusDraftId: queueFocusDraftId });"));
addCheck("selection helper exists in frontend", html.includes("function selectQueueDrafts(allDrafts, { focusDraftId = null } = {})"));
addCheck("default Queue shows <= 12 drafts", selected.length <= 12, String(selected.length));
addCheck("default Queue shows max 3 per persona", Object.values(counts).every((count) => count <= 3), JSON.stringify(counts));
addCheck("all four personas appear when they have drafts", personas.every((persona) => counts[persona.id] > 0), JSON.stringify(counts));
addCheck("Peptide Tracker drafts appear", selected.some((item) => item.personaId === "the-wonkette"), JSON.stringify(selected.map((item) => item.personaId)));
addCheck("Chris Klebl cannot dominate", counts["progressive-pat"] <= 3, JSON.stringify(counts));
addCheck("rejected/skipped/published drafts hidden", !["draft_rejected_hidden", "draft_skipped_hidden", "draft_published_hidden"].some((id) => selectedIds.has(id)), JSON.stringify([...selectedIds]));

const focusDraftId = "draft_progressive-pat_0";
const focused = selectQueueDrafts(drafts, { focusDraftId });
const focusedCounts = focused.reduce((acc, item) => {
  acc[item.personaId] = (acc[item.personaId] || 0) + 1;
  return acc;
}, {});
addCheck("focusDraftId makes exact out-of-cap draft visible", focused[0]?.id === focusDraftId && focused.some((item) => item.id === focusDraftId), JSON.stringify(focused.map((item) => item.id)));
addCheck("focused exception does not enable unlimited Queue", focused.length <= 13, String(focused.length));
addCheck("focused exception preserves default persona caps aside from focused persona", Object.entries(focusedCounts).every(([personaId, count]) => count <= (personaId === "progressive-pat" ? 4 : 3)), JSON.stringify(focusedCounts));

const failed = checks.filter((check) => !check.ok);
console.log(failed.length ? "FAIL queue draft distribution verification" : "PASS queue draft distribution verification");
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
process.exit(failed.length ? 1 : 0);
