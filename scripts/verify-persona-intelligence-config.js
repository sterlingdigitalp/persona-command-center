#!/usr/bin/env node
const baseUrl = (process.env.PCC_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const report = { pass: true, checks: [], errors: [] };

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
  if (!response.ok) {
    const error = new Error(json.error || text || `${path} returned ${response.status}`);
    error.status = response.status;
    error.text = text;
    error.path = path;
    throw error;
  }
  return json;
}

async function verifySchemaIntegration(persona) {
  const checks = [
    { key: "interests", label: "interests" },
    { key: "trackedEntities", label: "tracked entities" },
    { key: "crawlTargets", label: "crawl targets" },
    { key: "rssTopics", label: "RSS topics" }
  ];
  for (const c of checks) {
    if (!Array.isArray(persona[c.key])) {
      addCheck(`schema: persona ${persona.id} missing ${c.label}`, false, `Got ${typeof persona[c.key]}`);
      continue;
    }
    addCheck(`schema: persona ${persona.id} has ${c.label}`, true, `${c.key}: ${persona[c.key].length} items`);
  }
}

try {
  const personas = await api("/api/personas");
  addCheck("GET /api/personas returned array", Array.isArray(personas), `length: ${personas?.length || 0}`);

  for (const persona of personas) {
    await verifySchemaIntegration(persona);
  }

  const theWonkette = personas.find(p => p.id === "the-wonkette");
  if (theWonkette) {
    const newInterest = {
      label: `Test Interest ${Date.now()}`,
      weight: 3
    };
    const createdInterest = await api(`/api/personas/the-wonkette/interests`, {
      method: "POST",
      body: JSON.stringify(newInterest)
    });
    addCheck("POST /api/personas/:id/interests created",
      createdInterest && createdInterest.label === newInterest.label,
      `${createdInterest?.id} / ${createdInterest?.label} / W:${createdInterest?.weight}`);

    if (createdInterest && createdInterest.id) {
      const interestId = createdInterest.id;
      const updatedInterest = await api(`/api/personas/the-wonkette/interests/${interestId}`, {
        method: "PATCH",
        body: JSON.stringify({ weight: 5 })
      });
      addCheck("PATCH /api/personas/:id/interests/:id",
        updatedInterest && updatedInterest.weight === 5,
        `${updatedInterest?.id} weight:${updatedInterest?.weight}`);

      await api(`/api/personas/the-wonkette/interests/${interestId}`, { method: "DELETE" });
      addCheck("DELETE /api/personas/:id/interests/:id", true, `Deleted ${interestId}`);
    }
  }

  const pat = personas.find(p => p.id === "progressive-pat");
  if (pat) {
    const newTarget = {
      label: `Test Target ${Date.now()}`,
      url: "https://example.com/test",
      notes: "Verification test target",
      frequency: "daily"
    };
    const createdTarget = await api(`/api/personas/progressive-pat/crawl-targets`, {
      method: "POST",
      body: JSON.stringify(newTarget)
    });
    addCheck("POST /api/personas/:id/crawl-targets created",
      createdTarget && createdTarget.label === newTarget.label,
      `${createdTarget?.id} / ${createdTarget?.url}`);

    if (createdTarget && createdTarget.id) {
      await api(`/api/personas/progressive-pat/crawl-targets/${createdTarget.id}`, { method: "DELETE" });
      addCheck("DELETE /api/personas/:id/crawl-targets/:id", true, `Deleted ${createdTarget.id}`);
    }
  }

  const newTopic = {
    topic: `Test Topic ${Date.now()}`,
    provider: "rss",
    weight: 2
  };
  const createdTopic = await api(`/api/personas/policy-pete/rss-topics`, {
    method: "POST",
    body: JSON.stringify(newTopic)
  });
  addCheck("POST /api/personas/:id/rss-topics created",
    createdTopic && createdTopic.topic === newTopic.topic,
    `${createdTopic?.id} / ${createdTopic?.topic} / W:${createdTopic?.weight}`);

  if (createdTopic && createdTopic.id) {
    await api(`/api/personas/policy-pete/rss-topics/${createdTopic.id}`, { method: "DELETE" });
    addCheck("DELETE /api/personas/:id/rss-topics/:id", true, `Deleted ${createdTopic.id}`);
  }

  const entities = await api("/api/entities");
  addCheck("GET /api/entities", Array.isArray(entities), `count: ${entities?.length || 0}`);

  const karpathy = entities.find(e => e.name === "Andrej Karpathy");
  addCheck("seed entity Andrej Karpathy exists",
    Boolean(karpathy),
    karpathy ? `${karpathy.id} / type:${karpathy.type} / X:${karpathy.primary_x_handle || "none"}` : "not found");

  if (karpathy) {
    addCheck("entity has aliases_json",
      Boolean(karpathy.aliases_json),
      String(karpathy.aliases_json));

    addCheck("entity has primary_x_handle",
      Boolean(karpathy.primary_x_handle),
      karpathy.primary_x_handle);
  }

  if (pat && pat.trackedEntities && pat.trackedEntities.length > 0) {
    addCheck("progressive-pat has entity subscriptions", true,
      `${pat.trackedEntities.length} subscription(s): ${pat.trackedEntities.map(e => e.entity_name).join(", ")}`);
  }

  if (pat && pat.crawlTargets && pat.crawlTargets.length > 0) {
    addCheck("progressive-pat has crawl targets", true,
      `${pat.crawlTargets.length} target(s): ${pat.crawlTargets.map(t => t.url).join(", ")}`);
  }

  for (const persona of personas) {
    if (persona.interests && persona.interests.length > 0) {
      addCheck(`${persona.id} has interests`, true,
        `${persona.interests.length} interest(s): ${persona.interests.map(i => i.label).join(", ")}`);
    }
    if (persona.rssTopics && persona.rssTopics.length > 0) {
      addCheck(`${persona.id} has RSS topics`, true,
        `${persona.rssTopics.length} topic(s): ${persona.rssTopics.map(r => r.topic).join(", ")}`);
    }
  }

  const hermesExport = await api("/api/hermes/export");
  addCheck("GET /api/hermes/export returns data", Boolean(hermesExport), `has personas: ${Array.isArray(hermesExport.personas)}`);
  addCheck("Hermes export includes trackedEntities",
    Array.isArray(hermesExport.trackedEntities),
    `count: ${hermesExport.trackedEntities?.length || 0}`);

  if (hermesExport.personas && hermesExport.personas.length > 0) {
    const first = hermesExport.personas[0];
    addCheck("Hermes export persona includes interests",
      Array.isArray(first.interests), `${first.interests?.length || 0} items`);
    addCheck("Hermes export persona includes trackedEntities",
      Array.isArray(first.trackedEntities), `${first.trackedEntities?.length || 0} items`);
    addCheck("Hermes export persona includes crawlTargets",
      Array.isArray(first.crawlTargets), `${first.crawlTargets?.length || 0} items`);
    addCheck("Hermes export persona includes rssTopics",
      Array.isArray(first.rssTopics), `${first.rssTopics?.length || 0} items`);
  }

} catch (error) {
  report.pass = false;
  report.errors.push(error.message);
}

console.log(report.pass ? "PASS persona intelligence config verification" : "FAIL persona intelligence config verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
for (const error of report.errors) console.log(`ERROR - ${error}`);
process.exit(report.pass ? 0 : 1);
