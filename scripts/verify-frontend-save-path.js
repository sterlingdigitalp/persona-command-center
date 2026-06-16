#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const html = await readFile("outputs/persona-command-center.html", "utf8");
const checks = [];

function addCheck(name, ok) {
  checks.push({ name, ok });
}

function has(pattern) {
  return pattern instanceof RegExp ? pattern.test(html) : html.includes(pattern);
}

addCheck("savePersona function exists", has(/async function savePersona\(personaId\)/));
addCheck("Save button calls savePersona with backend persona id", has(/onclick="savePersona\('\$\{persona\.id\}'\)"/));
addCheck("Save button is explicit button type", has(/<button type="button" class="btn secondary" onclick="savePersona/));
addCheck("savePersona uses PATCH", has(/method:\s*"PATCH"/));
addCheck("savePersona calls /api/personas/:id", has(/apiFetch\(`\/api\/personas\/\$\{personaId\}`/));
addCheck("payload includes name", has(/name:\s*document\.getElementById\(`name-\$\{personaId\}`/));
addCheck("payload includes handle", has(/handle:\s*document\.getElementById\(`handle-\$\{personaId\}`/));
addCheck("payload includes niche", has(/niche:\s*document\.getElementById\(`niche-\$\{personaId\}`/));
addCheck("payload includes voiceTone", has(/voiceTone:\s*document\.getElementById\(`voice-\$\{personaId\}`/));
addCheck("payload includes platformStatus", has(/platformStatus:\s*document\.getElementById\(`platform-\$\{personaId\}`/));
addCheck("save response updates local persona", has(/lastPersonaResponse = updatedPersona/) && has(/personas = personas\.map/));
addCheck("save failure preserves draft payload", has(/error:\s*error\.message,\s*draft:\s*payload/));
addCheck("personas load before optional panels", has(/setupStatus = await apiFetch\("\/api\/setup\/status"\)/) && has(/const personaData = await apiFetch\("\/api\/personas"\)/) && has(/optionalApiFetch\("\/api\/signals\/today"/));
addCheck("direct file opens use localhost API base", has(/window\.location\.protocol === "file:" \? "http:\/\/127\.0\.0\.1:3000"/));
addCheck("__pccDebug is exposed", has(/window\.__pccDebug =/));
addCheck("debug testPersonaSave exists", has(/async function testPersonaSave\(personaId = "the-wonkette"\)/));
addCheck("setup screen exists", has(/id="setup"/) && has(/Set up your personas/));
addCheck("initializePersonas function exists", has(/async function initializePersonas\(\)/) && has(/apiFetch\("\/api\/personas\/initialize"/));
addCheck("debug exposes setup contract", has(/get backendPersonas\(\)/) && has(/get setupStatus\(\)/) && has(/initializePersonas,/));
addCheck("no frontend fallback persona array", !has(/fallbackPersonas/) && !has(/let personas = \[\.\.\./));
addCheck("no original persona objects rendered from frontend", !has(/name:\s*"The Wonkette"/) && !has(/name:\s*"PolicyPete"/) && !has(/name:\s*"MAGA Memester"/) && !has(/name:\s*"ProgressivePat"/));
addCheck("legacy fake persona IDs are not used", !has(/id:\s*"p[1-4]"/) && !has(/pcard-[1-4]/));

const failed = checks.filter((check) => !check.ok);
console.log(failed.length ? "FAIL frontend save path verification" : "PASS frontend save path verification");
for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}`);

process.exit(failed.length ? 1 : 0);
