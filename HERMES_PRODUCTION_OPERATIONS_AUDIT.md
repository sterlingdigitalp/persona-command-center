# Hermes Production Operations Audit

**Project:** Persona Command Center  
**Version state audited:** Phase 5A complete  
**Audit timestamp:** 2026-06-27 14:59-15:15 CDT  
**Repo:** `/Users/sterlingdigital/Documents/Codex/2026-06-15/you-are-working-from-the-existing`  
**Scope:** Production operations/configuration audit only. No source code was modified.

## Executive Verdict

| Question | Answer | Operational reason |
|---|---:|---|
| Is Hermes currently configured exactly as intended? | **No** | Hermes reports **0 active scheduled jobs**. All Persona Command Center production cron jobs are paused/disabled. The PCC backend was not listening on port 3000 at audit start. Default digest providers are only `rss,news`, not `rss,news,crawl4ai`. |
| Is Hermes delivering the intelligence Persona Command Center expects? | **Partially, only when manually run** | A production-equivalent manual digest completed and imported 12 provider-backed signals, but scheduled delivery is disabled and selected signals were overwhelmingly RSS, with only 2 News-selected signals and 0 Crawl4AI-selected signals. |
| Would tomorrow morning’s operator receive high-quality intelligence from RSS, News, and Crawl4AI without intervention? | **No** | Morning cron is paused; backend was not running; cron command omits `HERMES_DIGEST_PROVIDERS=rss,news,crawl4ai`; Crawl4AI did not contribute selected signals in the audit digest. |
| Is Hermes ready to support Phase 5B read-only X provider without architectural changes? | **Yes architecturally, no operationally** | Provider registry can register X, but `xProvider.js` is a throwing stub and no active production cron is running. Phase 5B can be added as a provider plugin without redesign, but it is not executable today. |

---

## Evidence Collected

- `hermes status --all`: gateway running, **Scheduled Jobs: 0 active, 13 total**.
- `hermes doctor`: Hermes health mostly OK; config version outdated `v30 -> v31`; optional keys missing; tools available.
- Initial PCC health probe: `curl http://127.0.0.1:3000/api/health` failed: port 3000 not listening.
- I temporarily started `node src/server.js` to run production-equivalent validation, then killed that background process. Port 3000 was again not listening afterward.
- SQLite checks: `PRAGMA integrity_check` returned `ok`; `PRAGMA journal_mode` returned `wal`; foreign-key check returned no rows.
- Crawl4AI health: `http://127.0.0.1:11235/health` returned `{"status":"ok","version":"0.9.0"}`.
- Production-equivalent manual digest command succeeded with providers `rss,news,crawl4ai`.
- Manual velocity scan command succeeded as an import run but imported/updated zero signals and created zero alerts.

---

# PART 1 — Cron Inventory

## Active Hermes cron inventory

**There are no active Hermes crons.** Hermes reports `0 active, 13 total`; every job in `~/.hermes/cron/jobs.json` has `enabled: false` and `state: paused`.

## Current Production Schedule

These are the Persona Command Center production-relevant jobs currently present, but all are disabled.

| Mission | Job name | Job ID | Enabled | Disabled | Schedule | Timezone | Next run | Last run | Duration | Last status | Retry policy | Output location |
|---|---|---|---:|---:|---|---|---|---|---|---|---|---|
| Morning Validation | `persona-command-center-morning-validation` | `187aed567186` | No | Yes | `40 5 * * *` | server-local; host showed CDT; prompt does not pin TZ | `2026-06-20T05:40:00-05:00` stale because paused | `2026-06-19T05:41:36-05:00` | Job JSON does not persist duration; latest report says validation import duration 21 ms | `ok` | repeat forever; no explicit retry/backoff configured | `~/.hermes/cron/output/187aed567186/` |
| Morning Digest | `persona-command-center-morning-digest` | `9de692df42c2` | No | Yes | `45 5 * * *` | server-local; host CDT | `2026-06-20T05:45:00-05:00` stale because paused | `2026-06-19T05:46:08-05:00` | Job JSON does not persist duration | `ok` | repeat forever; no explicit retry/backoff configured | `~/.hermes/cron/output/9de692df42c2/` |
| Midday Validation | `persona-command-center-midday-validation` | `2274ddc8803b` | No | Yes | `0 12 * * *` | server-local; host CDT | `2026-06-20T12:00:00-05:00` stale because paused | `2026-06-19T12:01:12-05:00` | Job JSON does not persist duration | `ok` | repeat forever; no explicit retry/backoff configured | `~/.hermes/cron/output/2274ddc8803b/` plus prompt asks write `outputs/hermes-midday-validation-report.md` |
| Midday Digest | `persona-command-center-midday-digest` | `2bcbaee9f9e1` | No | Yes | `5 12 * * *` | server-local; host CDT | `2026-06-20T12:05:00-05:00` stale because paused | `2026-06-19T12:06:19-05:00` | Latest report says completed in 41 ms | `ok` | repeat forever; no explicit retry/backoff configured | `~/.hermes/cron/output/2bcbaee9f9e1/` plus prompt asks write `outputs/hermes-midday-digest-report.md` |
| Velocity Scan | `persona-command-center-velocity-scan` | `ada123d235a3` | No | Yes | `0 16 * * *` | prompt says America/New_York, but stored schedule is server-local cron expression | `2026-06-20T16:00:00-05:00` stale because paused | `2026-06-19T16:01:50-05:00` | Job JSON does not persist duration | `ok` in job state, but latest saved report says **FAIL exit code 1 / HTTP 500** due wrong Next.js app on port 3000 | repeat forever; no explicit retry/backoff configured | `~/.hermes/cron/output/ada123d235a3/` |

### Commands and environment variables in production jobs

| Job | Command executed by prompt | Environment variables |
|---|---|---|
| Morning Validation | `node scripts/hermes-validation-job.js` | `PCC_BASE_URL=http://localhost:3000`, `HERMES_PROVIDER=lmstudio`, `HERMES_MODEL=qwen3.6-35b-a3b-mtp`, `HERMES_ENDPOINT=http://localhost:1234/v1`, `HERMES_JOB_NAME=daily-morning-validation` |
| Morning Digest | `npm run hermes:morning-digest` | same provider/model/endpoint; `HERMES_JOB_NAME=persona-command-center-morning-digest`; **no explicit `HERMES_DIGEST_PROVIDERS`, so script defaults to `rss,news` only** |
| Midday Validation | `node scripts/hermes-validation-job.js` | `HERMES_JOB_NAME=persona-command-center-midday-validation`; provider/model/endpoint as above |
| Midday Digest | `npm run hermes:morning-digest` | `HERMES_JOB_NAME=persona-command-center-midday-digest`; provider/model/endpoint as above; **no explicit Crawl4AI provider inclusion** |
| Velocity Scan | `node scripts/run-velocity-scan.js` | `HERMES_JOB_NAME=persona-command-center-velocity-scan`; provider/model/endpoint as above |

### Non-PCC cron note

There are 6 additional paused Polymarket/research jobs. They are unrelated to Persona Command Center and are also disabled.

---

# PART 2 — Mission Verification

| Mission | Purpose | Inputs | Providers used | Output | Destination | Failure behavior | Audit behavior | Verdict |
|---|---|---|---|---|---|---|---|---|
| Morning Validation | Validate Hermes ↔ PCC import/attribution path | PCC health endpoint; `scripts/hermes-validation-job.js`; validation payload | Hermes attribution only (`lmstudio` metadata); no RSS/News/Crawl | validation signal import | SQLite `signals`, `ingestion_runs`, Hermes cron output | Fails if backend not running or import fails | `hermes.import.completed`; validation metadata in run/signal | **Configured but disabled** |
| Morning Digest | Provider-backed morning briefing | active personas + active queries + recent topics | Stored cron uses default `rss,news`; manual audit used `rss,news,crawl4ai` | `morning_digest` signals | SQLite, operator queue, snapshots/history, audit | Script exits nonzero on HTTP/import failure; provider errors ignored inside digest | `hermes.provider_morning_digest.completed` and `hermes.import.completed` | **Works manually; disabled in cron; cron omits Crawl4AI** |
| Midday Validation | Same as validation ping at noon | validation script | Hermes attribution only | validation signal | SQLite/report file | same as morning validation | same import audit | **Configured but disabled** |
| Midday Digest | Same digest job at noon | active personas + queries | default `rss,news` only | digest signals + requested report | SQLite + `outputs/hermes-midday-digest-report.md` | same as morning digest | digest/import audit | **Configured but disabled; cron omits Crawl4AI** |
| Velocity Scan | Intended to evaluate acceleration/alerts | `scripts/run-velocity-scan.js` | None; sends an empty Hermes import payload | an `ingestion_runs` row with `run_type=velocity_scan` | SQLite only | Succeeds even with zero signals | `hermes.import.completed` | **Not production-equivalent to velocity requirements; creates no alerts** |

---

# PART 3 — Provider Verification

| Provider | Enabled | Disabled | Configured | Stub | Not implemented | Notes |
|---|---:|---:|---:|---:|---:|---|
| RSS | Yes | No | Yes | No | No | Registered provider; 4 active RSS persona queries; selected 10/12 audit digest signals. |
| News | Yes | No | Yes | No | No | Registered provider; 8 active News queries; selected 2/12 audit digest signals. |
| Crawl4AI | Partially | Operationally under-used | Yes | No | No | Registered and real endpoint available; 1 active query; **0 selected audit signals**; not in default providers and not in cron commands. |
| Mock | Registered but production-disabled | Yes for production | Yes | No | No | Production digest rejects mock unless `allowMock=true` or `NODE_ENV=test`; audit run selected 0 mock signals. |
| X | No | Yes | Registered only | Yes | Yes | `xProvider.js` throws `NotImplemented`. |
| Reddit | No | Yes | Registered only | Yes | Yes | `redditProvider.js` throws `NotImplemented`. |

**Mock production confirmation:** The production-equivalent audit digest had `mock_markers=0` in selected snapshots. However, the DB already contained 8 same-day `hermes.local` signals from an earlier non-provider/manual `persona-command-center-morning_digest` run. Those are not from the audit digest and should not be trusted as production provider-backed intelligence.

---

# PART 4 — Persona Coverage

| Persona | Search terms | Active providers | Active queries | Last successful execution | Signals today | Signals this week | Missing providers | Under-served? |
|---|---|---|---:|---|---:|---:|---|---|
| `maga-memester` / Scott Decoded | `conservative media viral clip campaign rally`; `border policy conservative influencers`; `culture war brands backlash media narrative` | News, RSS | 3 | 2026-06-27 audit digest | 5 | 5 | Crawl4AI, X, Reddit | **Yes — no Crawl4AI query; only RSS selected in audit.** |
| `policy-pete` / Sterling Digital | `federal budget reconciliation tax credits`; `education policy student loans schools`; `healthcare costs Medicaid Medicare policy` | News, RSS | 3 | 2026-06-27 audit digest | 5 | 5 | Crawl4AI, X, Reddit | **Yes — no Crawl4AI query; selected signals included off-topic RSS items.** |
| `progressive-pat` / Chris Klebl | `labor unions strike worker protections`; `housing affordability rent control tenants`; `climate policy clean energy jobs`; `https://en.wikipedia.org/wiki/Climate_change` | News, RSS, Crawl4AI | 4 | 2026-06-27 audit digest | 5 | 5 | X, Reddit | **Yes — has Crawl4AI query but 0 selected Crawl4AI signals.** |
| `the-wonkette` / Peptide Tracker | `Supreme Court ethics Congress campaign finance`; `DOJ oversight election law watchdog`; `2026 midterms polling legal challenges` | News, RSS | 3 | 2026-06-27 audit digest | 5 | 5 | Crawl4AI, X, Reddit | **Partially — News selected 1 signal; no Crawl4AI.** |

Provider query totals: Crawl4AI 1, News 8, RSS 4. All active personas are under-served for Crawl4AI. Three of four have no Crawl4AI query at all; the only Crawl4AI-enabled persona did not receive selected Crawl4AI output.

---

# PART 5 — Morning Digest Validation

## Production-equivalent command run

```bash
PCC_BASE_URL=http://127.0.0.1:3000 \
HERMES_PROVIDER=lmstudio \
HERMES_MODEL=qwen3.6-35b-a3b-mtp \
HERMES_ENDPOINT=http://localhost:1234/v1 \
HERMES_JOB_NAME=production-audit-morning-digest \
HERMES_DIGEST_PROVIDERS=rss,news,crawl4ai \
npm run hermes:morning-digest
```

Result:

```text
PASS provider-backed Hermes morning digest
runId: run_edc32a21-e89f-46c1-987a-e1d2ca940c82
candidateCount: 1570
freshCandidateCount: 532
staleFilteredCount: 1025
mockFilteredCount: 13
missingDateFilteredCount: 0
signalCount: 12
attribution: complete
the-wonkette: 3 signals
policy-pete: 3 signals
maga-memester: 3 signals
progressive-pat: 3 signals
```

## Required validations

| Requirement | Result |
|---|---|
| RSS contributes | **Yes.** 10 selected snapshots contained RSS candidates. |
| News contributes | **Yes, but weakly.** 2 selected snapshots contained News candidates. |
| Crawl4AI contributes | **No selected signals.** Crawl4AI endpoint was available and provider was requested, but selected digest snapshots contained 0 Crawl4AI candidates. |
| Chief of Staff receives all providers | **Input side: yes** via provider registry and `HERMES_DIGEST_PROVIDERS=rss,news,crawl4ai`; **selection side: no evidence of Crawl4AI selected output**. |
| Signals appear in operator dashboard | **Yes by DB state.** `signals.status='new'` count is 20; latest 12 from audit are new. |
| Signals appear in velocity engine/history | **History yes.** `signal_snapshots` count is 20; audit digest wrote 12 snapshots. Velocity alerts no. |
| Signals appear in audit | **Yes.** `hermes.provider_morning_digest.completed` and `hermes.import.completed` were written. |
| No mock signals | **Audit digest yes.** Selected audit snapshots contained 0 mock markers. |

---

# PART 6 — Velocity Validation

Manual velocity command:

```bash
PCC_BASE_URL=http://127.0.0.1:3000 \
HERMES_PROVIDER=lmstudio \
HERMES_MODEL=qwen3.6-35b-a3b-mtp \
HERMES_ENDPOINT=http://localhost:1234/v1 \
HERMES_JOB_NAME=production-audit-velocity-scan \
node scripts/run-velocity-scan.js
```

Result:

```text
PASS persona-command-center velocity scan
runId: run_81e4d3cf-a6cb-44bd-922c-cb02cb83e87c
runType: velocity_scan
imported: 0
updated: 0
signalsReceived: 0
```

| Requirement | Result |
|---|---|
| Reads provider-backed signals | **No evidence.** Script submits an empty import payload (`personas: []`). |
| Uses RSS | **No.** |
| Uses News | **No.** |
| Uses Crawl4AI | **No.** |
| Creates alerts | **No.** `velocity_alerts` count is 0. |
| Updates operator dashboard | **No signal/dashboard change from velocity scan.** It only creates an ingestion run. |
| No stale data | **Not proven.** The scan does not inspect freshness or source signals. |

Verdict: Velocity Scan exists as a scheduled/import heartbeat, but does not satisfy the stated production velocity mission.

---

# PART 7 — Freshness Validation

For all 20 signals created today after existing/manual and audit runs:

| Check | Result |
|---|---|
| 72-hour freshness | **Pass for stored signals:** 0 signals older than 72 hours by `first_seen_at`. |
| No historical resurfacing | **Pass for age; quality caveat for low freshness scores.** |
| No 2024/2025 recycled pages | **Pass:** 0 stored signal topics/evidence URLs contained 2024/2025 markers. |
| No stale RSS artifacts | **Partial.** Stored audit signals were within 72h, but two selected News signals had freshness scores 0 and 5; this indicates ranking/freshness weakness even if not older than 72h. |
| No mock domains | **Violation in existing same-day DB:** 8 pre-audit `hermes.local` signals exist from `persona-command-center-morning_digest`. Audit digest itself had 0 mock markers. |

Violations:

1. Existing same-day mock-like signals with evidence URLs under `https://hermes.local/morning_digest/...` remain in the operator queue.
2. Production cron prompts do not explicitly force `HERMES_DIGEST_PROVIDERS=rss,news,crawl4ai`, so tomorrow's scheduled digest would not validate Crawl4AI freshness even if unpaused.

---

# PART 8 — Crawl4AI Validation

| Item | Current value |
|---|---|
| Endpoint | `CRAWL4AI_ENDPOINT` or default `http://localhost:11235` |
| Endpoint health | **Real service available:** `/health` returned status `ok`, version `0.9.0`. |
| Authentication | `CRAWL4AI_API_KEY` optional; provider sends `Authorization: Bearer ...` only if set. |
| Timeout | `CRAWL4AI_TIMEOUT_MS` or default `30000` ms. Digest wrapper passes `timeoutMs=6000`, but provider config default is 30s. |
| Extraction strategy | Provider sends `DefaultExtractionStrategy`; config default says `markdown`. |
| Max pages | `CRAWL4AI_MAX_PAGES` or default `5`. |
| Max depth | `CRAWL4AI_MAX_DEPTH` or default `2`. |
| Fallback behavior | On POST failure, provider returns a mock Crawl4AI result if `ignoreProviderErrors`, `NODE_ENV=test`, or no API key. Morning digest calls the pipeline with `ignoreProviderErrors: true`, so fallback can activate. |
| Current production result | Real endpoint available, but selected audit signals contained **0 Crawl4AI snapshots**. |

Conclusion: **Real Crawl4AI is available**, but the production cron configuration does not use it, default providers omit it, and the provider's fallback path can generate mock-like Crawl4AI candidates when the service call fails.

---

# PART 9 — Operator Output Quality

Audit digest selected signal provider mix:

| Provider in selected audit snapshots | Count |
|---|---:|
| RSS | 10 |
| News | 2 |
| Crawl4AI | 0 |
| Mock | 0 |

Quality assessment:

| Dimension | Assessment |
|---|---|
| Relevant | **Mixed/weak.** Several selected signals were generic world news, fires, earthquakes, and Ukraine stories assigned to unrelated personas/queries. |
| Novel | **Mostly fresh by timestamp**, but novelty is not enough; topical matching is weak. |
| Actionable | **Low-to-medium.** A few signals are usable, e.g. student loans and Supreme Court/DOJ items. Many are not persona-actionable. |
| Well-ranked | **No.** RSS generic breaking-news items outranked more persona-specific News items; Crawl4AI produced no selected items. |
| Would an operator trust today’s queue? | **Not fully.** An operator could use it as raw leads, but not as a trusted high-quality queue without manual curation. |

---

# PART 10 — Health

| Component | Status | Evidence |
|---|---|---|
| Hermes health | **Mostly healthy** | `hermes doctor` OK except config version outdated and optional provider keys missing. |
| Cron health | **Not production-ready** | 0 active scheduled jobs; all PCC jobs paused. |
| SQLite health | **Healthy** | `integrity_check=ok`, WAL enabled, no FK violations returned. |
| Morning digest health | **Manual pass; scheduled fail-by-configuration** | Manual production-equivalent run passed; cron paused and omits Crawl4AI. |
| Import health | **Healthy** | Audit digest imported 12 signals; import run completed. |
| Audit health | **Healthy** | Audit log contains digest/import completed events. |
| No failed missions | **No** | Latest saved velocity cron report says FAIL/HTTP 500 despite job `last_status=ok`; all jobs paused. |
| No stuck jobs | **Pass** | No running cron jobs observed. |
| No disabled production jobs | **Fail** | All production PCC jobs are disabled. |

---

# PART 11 — Configuration Drift

Expected stack: **RSS, News, Crawl4AI, Provider Registry, Chief of Staff, Velocity, Operator**.

| Expected | Current runtime | Drift |
|---|---|---|
| RSS | Registered, configured, contributes selected signals | None |
| News | Registered, configured, contributes selected signals weakly | Quality/ranking drift; only 2/12 selected audit signals |
| Crawl4AI | Registered and endpoint available | **Operational drift:** omitted from defaults and cron commands; 0 selected signals |
| Provider Registry | Map-based registry with self-registering providers | None for architecture |
| Chief of Staff | Deterministic selector runs | Selection/ranking drift: generic RSS dominates and Crawl4AI absent from selected output |
| Velocity | Script exists and cron exists | **Mission drift:** script imports empty payload, reads no provider signals, creates no alerts |
| Operator | Signals stored as `new`; history snapshots present | Queue quality drift: mock-like old same-day signals still present; relevance weak |

---

# PART 12 — Recommendations

## Immediate

1. **Unpause/enable the five PCC production cron jobs** only after confirming the PCC backend is supervised and listening on the correct port.
2. **Add explicit provider list to digest cron commands:** `HERMES_DIGEST_PROVIDERS=rss,news,crawl4ai` for morning and midday digest jobs.
3. **Supervise `node src/server.js`** or otherwise ensure the PCC API, not a Next.js frontend, owns port 3000 before cron runs.
4. **Remove/quarantine same-day `hermes.local` mock-like signals from the operator queue** or clearly mark them non-production.
5. **Fix Velocity Scan operational behavior** so it evaluates existing provider-backed signal snapshots and creates alerts when thresholds are met, rather than importing an empty payload.

## Soon

1. Add a cron pre-flight check that verifies `/api/health` returns `service=persona-command-center` before running any mission.
2. Add a post-run assertion for digest jobs: RSS > 0, News > 0, Crawl4AI > 0 candidates and selected/provider-backed evidence; fail loudly if Crawl4AI is absent.
3. Add per-provider selected-signal counts to the morning digest response/report so under-contribution is visible without raw snapshot inspection.
4. Add Crawl4AI queries for the three personas that currently have none.
5. Improve relevance/ranking thresholds so generic RSS stories do not outrank persona-specific signals.

## Later

1. Add operational dashboards for cron enabled/paused state and last mission result.
2. Add Phase 5B X read-only provider behind the existing registry contract; no architecture redesign required.
3. Add provider health/fallback reporting that distinguishes real Crawl4AI extraction from mock fallback candidates.

---

## Readiness for Phase 5B

**Architectural readiness:** Yes. The provider registry, provider contract, pipeline, Chief of Staff, persistence, and audit layers are provider-agnostic enough for a read-only X provider.

**Operational readiness:** No. Current crons are paused, server is not continuously running, Velocity Scan does not perform the stated mission, and X is currently a `NotImplemented` stub.

**Final status:** Persona Command Center Phase 5A code paths can run manually, but Hermes is **not currently configured to operate Persona Command Center continuously in production**.
