#!/usr/bin/env node
import { execSql, initDb, querySql, sqlString } from "../src/db.js";

const NOISE_PATTERNS = [
  "mock",
  "demo",
  "smoke",
  "verification",
  "trial",
  "validation",
  "hermes.local",
  "example",
  "searchagent unavailable",
  "new opportunity detected",
  "crawl4ai mock"
];

function noiseSqlFilter(alias = "signals") {
  const p = alias ? `${alias}.` : "";
  const columns = [
    `${p}topic`,
    `${p}source`,
    `${p}source_provider`,
    `${p}hermes_provider`,
    `${p}hermes_model`,
    `${p}hermes_endpoint`,
    `${p}hermes_job_name`,
    `${p}hermes_run_type`,
    `${p}query`,
    `${p}evidence_urls`
  ];
  const textMatches = NOISE_PATTERNS.map((pattern) => {
    const escaped = pattern.replaceAll("'", "''");
    return `(${columns.map((column) => `LOWER(COALESCE(${column}, '')) LIKE '%${escaped}%'`).join(" OR ")})`;
  });
  return `((COALESCE(${p}test_mode, 0) = 1) OR ${textMatches.join(" OR ")})`;
}

await initDb();

const noisySignals = await querySql(`
  SELECT id, topic
  FROM signals
  WHERE status NOT IN ('dismissed', 'archived')
    AND ${noiseSqlFilter("")};
`);

if (noisySignals.length) {
  await execSql(`
    UPDATE signals
    SET status = 'archived',
        dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP),
        dismissal_reason = COALESCE(dismissal_reason, 'RC-1 production cleanup: mock/demo/test/fallback signal hidden from Operator')
    WHERE id IN (${noisySignals.map((signal) => sqlString(signal.id)).join(", ")});
  `);
}

const noisySignalIds = noisySignals.map((signal) => signal.id);
let noisyDrafts = [];
if (noisySignalIds.length) {
  noisyDrafts = await querySql(`
    SELECT id
    FROM drafts
    WHERE status NOT IN ('rejected', 'published')
      AND (${noisySignalIds.map((id) => `source_signal_ids LIKE '%${String(id).replaceAll("'", "''")}%'`).join(" OR ")});
  `);
  if (noisyDrafts.length) {
    await execSql(`
      UPDATE drafts
      SET status = 'rejected',
          rejection_reason = COALESCE(rejection_reason, 'RC-1 production cleanup: draft linked to mock/demo/test/fallback signal'),
          updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${noisyDrafts.map((draft) => sqlString(draft.id)).join(", ")});
    `);
  }
}

console.log(JSON.stringify({
  archivedSignals: noisySignals.length,
  rejectedDrafts: noisyDrafts.length,
  archivedSignalSamples: noisySignals.slice(0, 8).map((signal) => ({ id: signal.id, topic: signal.topic }))
}, null, 2));
