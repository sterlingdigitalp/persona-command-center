#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const report = { pass: true, checks: [], errors: [] };

function addCheck(name, ok, detail = "") {
  report.checks.push({ name, ok, detail });
  if (!ok) report.pass = false;
}

async function read(relativePath) {
  return readFile(path.join(rootDir, relativePath), "utf8");
}

function hasAll(text, values) {
  return values.every((value) => text.includes(value));
}

try {
  const [
    schema,
    migrations,
    server,
    packageJson,
    readme,
    readinessDoc,
    phase5Script
  ] = await Promise.all([
    read("db/schema.sql"),
    read("src/db.js"),
    read("src/server.js"),
    read("package.json"),
    read("README.md"),
    read("docs/x-api-readiness-report.md"),
    read("scripts/verify-phase-5-operator-loop.js")
  ]);

  addCheck(
    "published-post ledger exists in schema and migrations",
    schema.includes("CREATE TABLE IF NOT EXISTS published_posts") && migrations.includes("CREATE TABLE IF NOT EXISTS published_posts"),
    "published_posts"
  );
  addCheck(
    "review and rejection reason fields exist",
    hasAll(schema, ["review_reason", "dismissal_reason", "rejection_reason"]) && hasAll(migrations, ["review_reason", "dismissal_reason", "rejection_reason"]),
    "signals/drafts reasons"
  );
  addCheck(
    "draft quality checks are persisted",
    schema.includes("quality_checks TEXT NOT NULL DEFAULT '{}'") && migrations.includes("quality_checks"),
    "drafts.quality_checks"
  );
  addCheck(
    "manual workflow endpoints are implemented",
    hasAll(server, [
      '"/api/operator/queue"',
      "mark-published",
      '"/api/published-posts"',
      "/performance"
    ]),
    "operator queue / manual publish / published posts / performance"
  );
  addCheck(
    "operator queue declares local-only behavior",
    server.includes("noExternalPublishing: true") && server.includes("xCredentialsRequired: false"),
    "noExternalPublishing=true xCredentialsRequired=false"
  );
  addCheck(
    "no X/Twitter network endpoints are called from app code",
    !/api\.x\.com|api\.twitter\.com|twitter\.com\/i\/oauth|x\.com\/i\/oauth/i.test(server + migrations + phase5Script),
    "no X API URLs found"
  );
  addCheck(
    "no X credentials are required by runtime code",
    !/process\.env\.(X_|TWITTER_)/.test(server + migrations),
    "no X_* or TWITTER_* env reads in runtime"
  );
  addCheck(
    "phase 5 verifier covers full local workflow",
    hasAll(phase5Script, [
      "/api/hermes/import",
      "/mark-reviewed",
      "/api/drafts/generate",
      "/reject",
      "/approve",
      "/api/schedule",
      "/mark-published",
      "/performance",
      "/api/operator/queue",
      "/history"
    ]),
    "signal -> draft -> review -> schedule -> publish -> performance -> queue/history"
  );
  addCheck(
    "npm exposes readiness verification",
    packageJson.includes('"verify:x-api-readiness"') && packageJson.includes("scripts/verify-x-api-readiness.js"),
    "verify:x-api-readiness"
  );
  addCheck(
    "README documents no-X workflow and readiness check",
    hasAll(readme, [
      "Phase 5 Local Operator Loop",
      "does not require X credentials",
      "does not call the X API",
      "npm run verify:phase5",
      "npm run verify:x-api-readiness"
    ]),
    "README Phase 5 docs"
  );
  addCheck(
    "readiness report covers required sections",
    hasAll(readinessDoc, [
      "Already Complete",
      "Still Manual",
      "Environment Variables Required Later",
      "Permissions And Scopes Required Later",
      "Integration Sequence Once Credentials Exist",
      "Remaining Risks Before Real X Integration"
    ]),
    "docs/x-api-readiness-report.md"
  );
  addCheck(
    "future env vars are documented but not required now",
    hasAll(readinessDoc, ["X_API_KEY", "X_CLIENT_ID", "X_ACCESS_TOKEN", "X_REFRESH_TOKEN"]) && readinessDoc.includes("Do not set these for Phase 5"),
    "future-only X env vars"
  );
  addCheck(
    "future scopes are documented",
    hasAll(readinessDoc, ["Read account/user identity", "Read posts/tweets", "Write posts/tweets", "Media upload"]),
    "minimum future scopes"
  );
  addCheck(
    "integration sequence is explicit",
    hasAll(readinessDoc, ["credential/config validation", "read-only account health", "recent-search provider", "metric refresh", "dry-run publishing", "real publishing"]),
    "ordered integration plan"
  );
} catch (error) {
  report.pass = false;
  report.errors.push(error.message);
}

console.log(report.pass ? "PASS X API readiness verification" : "FAIL X API readiness verification");
for (const check of report.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
}
for (const error of report.errors) console.log(`ERROR - ${error}`);
process.exit(report.pass ? 0 : 1);
