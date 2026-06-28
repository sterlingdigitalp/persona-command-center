import { rm } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const dbPath = path.join(rootDir, "work", "verify-persona-writing-export.sqlite");
const checks = [];

function addCheck(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}

process.env.DB_PATH = dbPath;
process.env.DISABLE_HERMES_BOOTSTRAP = "1";
await rm(dbPath, { force: true });

const db = await import("../src/db.js");
const server = await import("../src/server.js");

try {
  await db.initDb();
  const personas = await server.getPersonas({ includeInactiveQueries: true });
  const target = personas.find((persona) => persona.id === "the-wonkette") || personas[0];
  const deletedInterest = target.interests[0];
  if (deletedInterest) await server.deletePersonaInterest(deletedInterest.id);
  const added = await server.createPersonaInterest(target.id, { label: `Writing Export Interest ${Date.now()}`, weight: 5 });
  await server.updatePersona("policy-pete", {
    voiceControls: {
      humorLevel: "low",
      contrarianLevel: "low",
      explainerLevel: "high",
      punchinessLevel: "medium",
      memeLevel: "low",
      technicalDepth: "high",
      emotionalIntensity: "low",
      riskTolerance: "low",
      formalityLevel: "high"
    }
  });
  await server.updatePersona("maga-memester", {
    voiceControls: {
      humorLevel: "high",
      contrarianLevel: "high",
      explainerLevel: "low",
      punchinessLevel: "high",
      memeLevel: "high",
      technicalDepth: "low",
      emotionalIntensity: "medium",
      riskTolerance: "medium",
      formalityLevel: "low"
    }
  });

  await db.initDb();
  const exported = await server.exportHermesState();
  addCheck("Hermes export includes all 4 personas", exported.personas.length === 4, String(exported.personas.length));
  const voiceFingerprints = new Set(exported.personas.map((persona) => JSON.stringify(persona.voiceControls)));
  addCheck("all 4 personas export distinct voice controls", voiceFingerprints.size === 4, JSON.stringify([...voiceFingerprints]));
  addCheck("writingGuidance exists for every persona", exported.personas.every((persona) => persona.writingGuidance?.personaName && Array.isArray(persona.writingGuidance.writingDo)), JSON.stringify(exported.personas.map((persona) => persona.writingGuidance)));

  const exportTarget = exported.personas.find((persona) => persona.id === target.id);
  const exportedInterestIds = new Set((exportTarget?.interests || []).map((interest) => interest.id));
  addCheck("interests export reflects user deletion", deletedInterest ? !exportedInterestIds.has(deletedInterest.id) : true, JSON.stringify(exportTarget?.interests || []));
  addCheck("interests export reflects user addition", exportedInterestIds.has(added.id) && exportTarget.writingGuidance.interests.includes(added.label), JSON.stringify(exportTarget?.writingGuidance || {}));

  const draftPersona = exported.personas.find((persona) => persona.id === "maga-memester") || exported.personas[0];
  const drafts = await server.generateDrafts({ personaId: draftPersona.id, count: 3 });
  addCheck("generated draft metadata identifies persona voice config", drafts.every((draft) => draft.editorialMetadata?.personaVoiceConfig?.voiceControls && draft.editorialMetadata?.personaVoiceConfig?.interests), JSON.stringify(drafts.map((draft) => draft.editorialMetadata?.personaVoiceConfig)));
  addCheck("fallback drafts use distinct persona voice text", new Set(drafts.map((draft) => draft.body)).size === drafts.length && drafts.some((draft) => /funny|watch this|consensus|lazy/i.test(draft.body)), drafts.map((draft) => draft.body).join("\n"));
} catch (error) {
  addCheck("persona writing export verification ran", false, error.stack || error.message);
} finally {
  await rm(dbPath, { force: true });
}

const failed = checks.filter((check) => !check.ok);
console.log(failed.length ? "FAIL persona writing export verification" : "PASS persona writing export verification");
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
process.exit(failed.length ? 1 : 0);
