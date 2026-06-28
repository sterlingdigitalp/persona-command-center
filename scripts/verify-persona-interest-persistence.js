import { rm } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const dbPath = path.join(rootDir, "work", "verify-persona-interest-persistence.sqlite");
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
  const seeded = await server.getPersonas({ includeInactiveQueries: true });
  const persona = seeded.find((item) => (item.interests || []).length);
  const seededInterest = persona?.interests?.[0];
  addCheck("seeded interest found", Boolean(persona && seededInterest), `${persona?.id || "none"} / ${seededInterest?.id || "none"}`);

  await server.deletePersonaInterest(seededInterest.id);
  const added = await server.createPersonaInterest(persona.id, { label: `Verifier Added Interest ${Date.now()}`, weight: 5 });
  await db.initDb();

  const reloaded = await server.getPersonas({ includeInactiveQueries: true });
  const reloadedPersona = reloaded.find((item) => item.id === persona.id);
  const reloadedLabels = (reloadedPersona?.interests || []).map((interest) => interest.label);
  const reloadedIds = new Set((reloadedPersona?.interests || []).map((interest) => interest.id));
  addCheck("deleted seeded interest absent after backend reload/init", !reloadedIds.has(seededInterest.id), JSON.stringify(reloadedPersona?.interests || []));
  addCheck("added interest persists after reload/init", reloadedIds.has(added.id), JSON.stringify(reloadedPersona?.interests || []));

  const exported = await server.exportHermesState();
  const exportPersona = exported.personas.find((item) => item.id === persona.id);
  const exportInterestIds = new Set((exportPersona?.interests || []).map((interest) => interest.id));
  const exportInterestLabels = (exportPersona?.writingGuidance?.interests || []);
  addCheck("deleted interest absent from /api/hermes/export", !exportInterestIds.has(seededInterest.id) && !exportInterestLabels.includes(seededInterest.label), JSON.stringify(exportPersona?.interests || []));
  addCheck("added interest present in /api/hermes/export", exportInterestIds.has(added.id) && exportInterestLabels.includes(added.label), JSON.stringify(exportPersona?.writingGuidance || {}));
} catch (error) {
  addCheck("persona interest persistence verification ran", false, error.stack || error.message);
} finally {
  await rm(dbPath, { force: true });
}

const failed = checks.filter((check) => !check.ok);
console.log(failed.length ? "FAIL persona interest persistence verification" : "PASS persona interest persistence verification");
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
process.exit(failed.length ? 1 : 0);
