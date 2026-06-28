#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const baseUrl = (process.env.PCC_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const html = await readFile("outputs/persona-command-center.html", "utf8");
const report = { pass: true, checks: [], errors: [] };

function addCheck(name, ok, detail = "") {
  report.checks.push({ name, ok, detail });
  if (!ok) report.pass = false;
}

function has(pattern) {
  return pattern instanceof RegExp ? pattern.test(html) : html.includes(pattern);
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `${path} returned ${response.status}`);
  return json;
}

// Static HTML checks: readPersonaDraft niche fallback
addCheck(
  "readPersonaDraft falls back to persona.niche when niche DOM element absent",
  has(/nicheInput \? nicheInput\.value : \(persona\?\.niche \|\| ""\)/),
  "found fallback expression"
);

addCheck(
  "readPersonaDraft finds persona from personas array",
  has(/const persona = personas\.find\(\(item\) => item\.id === personaId\);/),
  "persona lookup present"
);

addCheck(
  "readPersonaDraft checks nicheInput existence",
  has(/const nicheInput = document\.getElementById\(`niche-\$\{personaId\}`\);/),
  "nicheInput reference present"
);

// Static HTML checks: editor card header uses draft.name when editing
addCheck(
  "editor card header shows draft.name when editing",
  has(/escapeHtml\(editing && draft\.name \? draft\.name : persona\.name\)/),
  "draft.name fallback in card header"
);

addCheck(
  "editor account shows draft.handle when editing",
  has(/escapeHtml\(editing && draft\.handle \? draft\.handle : \(persona\.account \|\| persona\.handle\)\)/),
  "draft.handle fallback in account"
);

// Live API checks (requires running server)
let persona;
let original;
let createdQuery;
let watchListBefore;

try {
  const personas = await api("/api/personas");
  persona = personas[0];
  if (!persona) throw new Error("No personas found");

  original = {
    name: persona.name,
    handle: persona.handle,
    niche: persona.niche,
    voiceTone: persona.voiceTone,
    platformStatus: persona.platformStatus === "mock" ? "active" : persona.platformStatus || "active"
  };

  // Record current Watch List subscriptions before we start
  watchListBefore = (persona.trackedEntities || []).map((e) => e.id);

  // Fix 1: save succeeds WITHOUT niche in payload (simulating missing niche DOM element)
  const suffix = `SaveRegression ${Date.now()}`;
  const saveWithoutNiche = await api(`/api/personas/${persona.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: `${original.name} ${suffix}`,
      handle: String(original.handle || persona.account || "@persona").replace(/^@/, ""),
      voiceTone: `${original.voiceTone} Regression check.`,
      platformStatus: "configured"
    })
  });
  addCheck(
    "save succeeds without niche field in payload (no 400)",
    Boolean(saveWithoutNiche.name.includes(suffix)),
    `status: ${saveWithoutNiche.name}`
  );

  // Fix 2: saved display name persists after reload (re-fetch from list endpoint which includes trackedEntities)
  const refetchedList = await api("/api/personas");
  const refetched = refetchedList.find((p) => p.id === persona.id);
  addCheck(
    "saved display name persists after reload",
    refetched.name.includes(suffix),
    refetched.name
  );

  addCheck(
    "card title does not revert to seed/default label",
    refetched.name.includes(suffix),
    `name is "${refetched.name}" not seed default`
  );

  // Verify niche was preserved even though not sent in payload
  addCheck(
    "niche preserved when omitted from payload",
    refetched.niche === original.niche,
    `niche: "${refetched.niche}" === "${original.niche}"`
  );

  // Verify voiceTone was saved
  addCheck(
    "voiceTone saved alongside name",
    refetched.voiceTone.includes("Regression check."),
    refetched.voiceTone
  );

  // Verify platform status survived
  addCheck(
    "platform status persisted",
    refetched.platformStatus === "configured",
    refetched.platformStatus
  );

  // Verify Watch Lists remain intact
  const watchListAfter = (refetched.trackedEntities || []).map((e) => e.id);
  const lostEntities = watchListBefore.filter((id) => !watchListAfter.includes(id));
  addCheck(
    "Watch List entities intact after save",
    lostEntities.length === 0 && watchListAfter.length === watchListBefore.length,
    lostEntities.length ? `lost entities: ${lostEntities.join(",")}` : `${watchListAfter.length} entities unchanged`
  );

  // Verify existing queries still present
  addCheck(
    "existing queries not lost after save",
    refetched.queries.length === persona.queries.length,
    `queries: ${refetched.queries.length} vs ${persona.queries.length}`
  );

} catch (error) {
  report.pass = false;
  report.errors.push(error.message);
} finally {
  if (persona && original) {
    try {
      await api(`/api/personas/${persona.id}`, {
        method: "PATCH",
        body: JSON.stringify(original)
      });
      const restored = await api(`/api/personas/${persona.id}`);
      addCheck(
        "persona restored to original state",
        restored.name === original.name && restored.handle === original.handle && restored.platformStatus === original.platformStatus,
        `${restored.name} ${restored.platformStatus}`
      );
    } catch (error) {
      report.pass = false;
      report.errors.push(`restore persona failed: ${error.message}`);
    }
  }
}

console.log(report.pass ? "PASS persona save regression verification" : "FAIL persona save regression verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
for (const error of report.errors) console.log(`ERROR - ${error}`);
process.exit(report.pass ? 0 : 1);
