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
addCheck("frontend build marker exists", has(/persona-api-connected-v2/) && has(/PCC_FRONTEND_BUILD/));
addCheck("absolute API_BASE is centralized", has(/const API_BASE = window\.location\.protocol === "file:"/) && has(/: window\.location\.origin/));
addCheck("Save button calls savePersona with backend persona id", has(/const personaIdArg = jsArg\(persona\.id\)/) && has(/onclick="savePersona\(\$\{personaIdArg\}\)"/));
addCheck("Save button is explicit button type", has(/<button type="button" class="btn secondary" onclick="savePersona/));
addCheck("savePersona uses PATCH", has(/method:\s*"PATCH"/));
addCheck("savePersona calls encoded /api/personas/:id", has(/function personaApiPath\(personaId\)/) && has(/encodeURIComponent\(String\(personaId\)\)/) && has(/apiFetch\(saveUrl/));
addCheck("payload includes name", has(/name:\s*document\.getElementById\(`name-\$\{personaId\}`/));
addCheck("payload includes handle", has(/handle:\s*document\.getElementById\(`handle-\$\{personaId\}`/));
addCheck("payload includes niche", has(/niche:\s*document\.getElementById\(`niche-\$\{personaId\}`/));
addCheck("payload includes voiceTone", has(/voiceTone:\s*document\.getElementById\(`voice-\$\{personaId\}`/));
addCheck("payload includes platformStatus", has(/platformStatus:\s*document\.getElementById\(`platform-\$\{personaId\}`/));
addCheck("automation status helper is documented", has(/Automation Status/) && has(/Active personas are included in Hermes ingestion\. Draft or disconnected personas are skipped\./));
addCheck("search terms use persona field layout", has(/field-label/) && has(/search-term-field/) && has(/search-term-display-list/) && has(/search-term-edit-list/) && has(/search-term-edit-row/));
addCheck("search terms edit with persona-level controls", has(/addPersonaQueryDraft/) && has(/removePersonaQueryDraft/) && has(/savePersonaQueryDiff/) && has(/readPersonaQueryDrafts/));
addCheck("bulky search term card layout removed", !has(/search-term-card/) && !has(/query-list/) && !has(/query-row/) && !has(/query-actions/) && !has(/search-term-edit-grid/) && !has(/class="search-term-display"/));
addCheck("row-level query edit buttons removed", !has(/onclick="savePersonaQuery/) && !has(/onclick="cancelPersonaQueryEdit/) && !has(/onclick="editPersonaQuery/) && !has(/renderPersonaQueryRow/));
addCheck("save response updates local persona", has(/lastPersonaResponse = updatedPersona/) && has(/personas = personas\.map/));
addCheck("save failure preserves draft payload", has(/error:\s*error\.message,\s*draft:\s*payload/));
addCheck("personas load before optional panels", has(/const backend = await testBackend\(\)/) && has(/const personaData = backend\.personas/) && has(/optionalApiFetch\("\/api\/setup\/status"/) && has(/optionalApiFetch\("\/api\/signals\/today"/));
addCheck("apiFetch records URL/status/error", has(/lastFetchUrl = url/) && has(/lastFetchStatus = response\.status/) && has(/lastFetchError = error\.message/));
addCheck("persona save debug records request and response", has(/lastPersonaSaveRequest/) && has(/lastPersonaSaveResponse/) && has(/error\.status/) && has(/error\.text/));
addCheck("forced backend self-test exists", has(/async function testBackend\(\)/) && has(/apiFetch\("\/api\/health"\)/) && has(/apiFetch\("\/api\/personas"\)/));
addCheck("detailed backend error exists", has(/function describeBackendError\(error\)/) && has(/Request URL:/) && has(/API_BASE:/));
addCheck("direct file opens use localhost API base", has(/"http:\/\/127\.0\.0\.1:3000"/));
addCheck("__pccDebug is exposed", has(/window\.__pccDebug =/));
addCheck("__pccDebug exposes requested fetch fields", has(/apiBase: API_BASE/) && has(/frontendBuild: PCC_FRONTEND_BUILD/) && has(/lastFetchUrl: null/) && has(/testBackend,/));
addCheck("__pccDebug exposes persona id lister", has(/function listPersonaIds\(\)/) && has(/listPersonaIds,/));
addCheck("__pccDebug exposes query actions", has(/addPersonaQuery,/) && has(/updatePersonaQuery,/) && has(/deletePersonaQuery,/) && has(/togglePersonaQuery,/));
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
