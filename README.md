# Persona Command Center

Persona Command Center is a local SQLite-backed intelligence and review dashboard for persona-specific signal gathering, Hermes-assisted briefing import, draft review, and scheduling preparation. The frontend is a single-file HTML app served by a small Node backend.

## Current Phase Status

The current build includes Phase 4F plus frontend-first persona setup hardening:

- SQLite persistence for personas, queries, signals, drafts, scheduled posts, ingestion runs, and audit events.
- RSS/news provider-backed ingestion with freshness filtering, deduplication, clustering, scoring, and suggested angles.
- Hermes simulation, validation, import, attribution, morning digest, and velocity scan support.
- Velocity alert engine for comparing signal snapshots.
- Phase 5 local operator loop for review reasons, X draft checks, manual published-post tracking, and manual performance capture.
- First-run persona setup when the backend has zero personas.
- Persistent Persona Editor and search-term editor backed only by SQLite state.

The app now supports:

```text
Hermes morning digest / velocity scan / midday brief / evening scan
  -> Hermes import pipeline
  -> signal persistence and score history
  -> signal review
  -> draft review
  -> schedule preparation
```

Known limitations: this repo does not integrate the X API yet, does not scrape pages, does not publish posts externally, does not add authentication, does not call external LLMs from the app, and does not add Instagram, YouTube, or TikTok adapters. Hermes cron/operator commands are documented for local integration, but no hosted scheduler is bundled into the app.

Phase 4A adds a real round-trip validation path:

```text
Persona Command Center export -> Hermes-compatible job -> Hermes import -> validation signal in dashboard
```

Phase 4C hardens Hermes attribution for unattended morning jobs. Every Hermes payload should include provider, model, endpoint, and job name at the top level. The app inherits those values onto every imported signal, while signal-level attribution can override the top-level values when needed.

Phase 4D adds the production-style morning digest path:

```text
Hermes cron -> provider-backed digest endpoint -> RSS/news providers -> scoring -> Chief of Staff selection -> Hermes morning_digest import
```

Version 1 remains available for validation and simulation. Version 2 is the recommended morning digest architecture: Hermes acts as Chief of Staff while the app’s public-feed providers gather and score the source material. Production Version 2 runs use RSS/news only; the mock provider is test/dev only and must be explicitly allowed.

## Install

Node 22+ and the local `sqlite3` CLI are required.

```bash
npm install
```

There are no runtime npm dependencies. The server uses Node built-ins, `fetch`, and the system SQLite CLI.

## Initialize Or Upgrade The Database

```bash
npm run init:db
```

This creates or upgrades `data/persona-command-center.sqlite`, applies the idempotent schema in `db/schema.sql`, runs migrations, and seeds personas, persona queries, platform placeholders, and Hermes settings.

Seed data is insert-only. Running database init after production persona edits will add missing default records, but it will not overwrite existing personas, search terms, or platform placeholders. Persona and search-term edits are marked with `userEdited`, `userEditedAt`, and `lockedFromSeedOverwrite` so future seed/setup logic can protect real configuration.

Default Hermes settings:

- Morning Digest enabled
- Velocity Scan enabled
- Midday Brief enabled
- Evening Scan enabled
- Simulation Mode enabled
- Archive after 7 days

## First-Run Persona Setup

The frontend does not render built-in persona data. When the backend is reachable, personas shown in the dashboard come only from `GET /api/personas`. If the backend has zero personas, the dashboard opens a required setup screen and saves four persona lanes through `POST /api/personas/initialize`.

First-run setup requires each persona to include:

- name
- X handle
- interest / niche
- voice / tone
- at least 3 search terms

Development reset for testing the empty first-run flow:

```bash
curl -X POST http://127.0.0.1:3000/api/setup/reset-personas \
  -H 'content-type: application/json' \
  -d '{"confirm":"DELETE_PERSONAS"}'
```

The older `RESET_PERSONAS` phrase is intentionally rejected. Destructive reset is for development verification only and is logged as `destructive_reset.executed`.

Verify the full first-run setup contract:

```bash
npm run verify:first-run-setup
```

## Persona Editing

The Persona dashboard section edits persisted SQLite configuration, not local mock state.

Editable persona fields:

- name
- X handle
- interest / niche
- voice / tone
- platform status: `active`, `configured`, `draft`, or `disconnected`

Automation status meanings:

- `active`: persona is live and eligible for Hermes ingestion and draft generation.
- `configured`: account/details exist, but this is not fully active automation yet.
- `draft`: persona is still being built and does not feed provider-backed automation.
- `disconnected`: account/platform is unavailable or intentionally disabled.

Editable search term fields:

- query text
- provider: `rss` or `news`
- weight: `1` to `5`
- active / inactive status

Every persona save, query create, query update, query toggle, and query delete calls the backend and refreshes state from SQLite. Active personas with active persona queries feed the provider-backed Hermes morning digest immediately; no server restart is required. `GET /api/hermes/export` includes the current persona and query configuration so Hermes can see the same state the dashboard edits. Legacy `mock` persona/platform status values are normalized to real local states (`active` for personas, `configured` for platform account placeholders).

Verify persistence:

```bash
npm run verify:persona-persistence
npm run verify:persona-protection
npm run verify:frontend-save-path
```

Manual browser save check:

1. Start the server with `npm run dev`.
2. Open `http://127.0.0.1:3000`.
3. Go to Personas.
4. Edit The Wonkette name to `The Wonkette Test`.
5. Click Save and confirm the card reports Saved.
6. Refresh the browser and confirm `The Wonkette Test` is still visible.
7. Change the name back to `The Wonkette`, save again, refresh again, and confirm the original name persists.

After a browser save, verify SQLite-backed state directly:

```bash
curl http://127.0.0.1:3000/api/personas/the-wonkette
```

For browser console diagnostics:

```js
window.__pccDebug.backendPersonas
window.__pccDebug.setupStatus
window.__pccDebug.lastPersonaRequest
window.__pccDebug.lastPersonaResponse
window.__pccDebug.lastPersonaError
await window.__pccDebug.testPersonaSave("the-wonkette")
```

Manual first-run setup check:

1. Start the server with `npm run dev`.
2. Reset personas with the explicit reset command above.
3. Open `http://127.0.0.1:3000`.
4. Confirm the setup screen appears instead of persona cards.
5. Enter four personas with three search terms each.
6. Click Save setup and confirm the dashboard appears.
7. Refresh and confirm the same personas remain.

## Run The Dev Server

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

On startup, if Hermes simulation mode and Morning Digest are enabled, the server creates a simulated Hermes morning briefing when one does not already exist for today. That means the dashboard can open with a curated briefing before anyone clicks `Run ingestion`.

For tests or controlled runs, disable this with:

```bash
DISABLE_HERMES_BOOTSTRAP=1 npm run dev
```

## Hermes Responsibilities

Hermes is treated as an external intelligence service.

Hermes owns:

- discovery
- monitoring
- clustering recommendations
- scoring assistance
- signal recommendations

The app owns:

- persistence
- review workflow
- draft workflow
- scheduling workflow
- audit logging

## Hermes Job Types

- `morning_digest`: creates today’s briefing and top signals per persona.
- `velocity_scan`: monitors acceleration and updates priority scores.
- `midday_brief`: identifies emerging opportunities.
- `evening_scan`: updates scores and prepares old signals for archiving.

## Provider-Backed Morning Digest

Hermes cron should call the Version 2 endpoint:

```bash
curl -X POST http://127.0.0.1:3000/api/hermes/morning-digest/run \
  -H 'content-type: application/json' \
  -d '{
    "provider":"lmstudio",
    "model":"qwen3.6-35b-a3b-mtp",
    "endpoint":"http://localhost:1234/v1",
    "jobName":"persona-command-center-morning-digest",
    "maxSignalsPerPersona":3,
    "providers":["rss","news"]
  }'
```

This route loads personas and active queries, runs the existing RSS/news provider pipeline, filters candidates to original `publishedAt` timestamps from the last 72 hours, removes updated/revised old content, dedupes and clusters candidates, scores them, applies the deterministic Chief of Staff selector, and stores the selected signals through the Hermes import pipeline with full attribution.

Freshness rules:

- Production providers default to `["rss","news"]`.
- `mock` is ignored unless `allowMock=true` is explicitly passed or the app is running with `NODE_ENV=test`.
- Original `publishedAt` is the source of truth.
- Missing, invalid, older-than-72-hour, mock-domain, and obvious updated/archive/revised items are filtered out.

Check the latest provider-backed digest:

```bash
curl http://127.0.0.1:3000/api/hermes/morning-digest/latest
```

Compact verification payload:

```bash
curl "http://127.0.0.1:3000/api/hermes/morning-digest/latest?compact=true"
```

Manual operator command:

```bash
PCC_BASE_URL=http://127.0.0.1:3000 \
HERMES_PROVIDER=lmstudio \
HERMES_MODEL=qwen3.6-35b-a3b-mtp \
HERMES_ENDPOINT=http://localhost:1234/v1 \
npm run hermes:morning-digest
```

Digest quality check:

```bash
npm run verify:digest-quality
```

Recommended Hermes cron command for the 05:45 ET morning digest:

```bash
cd /Users/sterlingdigital/Documents/Codex/2026-06-15/you-are-working-from-the-existing && \
PCC_BASE_URL=http://127.0.0.1:3000 \
HERMES_PROVIDER=lmstudio \
HERMES_MODEL=qwen3.6-35b-a3b-mtp \
HERMES_ENDPOINT=http://localhost:1234/v1 \
npm run hermes:morning-digest
```

## Hermes Import

```bash
curl -X POST http://127.0.0.1:3000/api/hermes/import \
  -H 'content-type: application/json' \
  -d @payload.json
```

The import pipeline will:

- validate payloads
- deduplicate against recent non-archived signals
- update duplicates
- insert new signals
- write `signal_snapshots` for score history
- create an `ingestion_runs` row
- write audit events

See [docs/hermes-contract.md](docs/hermes-contract.md) for the payload contract.

Hermes payloads should include:

```json
{
  "provider": "lmstudio",
  "model": "qwen3.6-35b-a3b-mtp",
  "endpoint": "http://localhost:1234/v1",
  "jobName": "persona-command-center-morning_digest"
}
```

Top-level attribution is inherited by all imported signals. Signal-level `provider`, `model`, `endpoint`, and `jobName` values override top-level attribution for that signal only.

## Hermes Export

Hermes-compatible jobs should first read app state:

```bash
curl http://127.0.0.1:3000/api/hermes/export
```

The export includes:

- personas
- persona queries
- recent signals
- Hermes settings
- contract version

## Real Connectivity Validation

Start the app:

```bash
npm run dev
```

In another terminal, run:

```bash
PCC_BASE_URL=http://localhost:3000 \
HERMES_PROVIDER=lmstudio \
HERMES_MODEL=qwen3.6-35b-a3b-mtp \
HERMES_ENDPOINT=http://localhost:1234/v1 \
node scripts/hermes-validation-job.js
```

The script:

1. calls `GET /api/hermes/export`
2. builds a `validation_ping` payload
3. posts to `POST /api/hermes/import`
4. prints the validation id and imported signal ids

To run equivalent validation in-process:

```bash
curl -X POST http://127.0.0.1:3000/api/hermes/validate \
  -H 'content-type: application/json' \
  -d '{}'
```

Confirm it worked:

```bash
curl http://127.0.0.1:3000/api/hermes/health
sqlite3 data/persona-command-center.sqlite "SELECT topic, hermes_provider, hermes_model, hermes_endpoint, validation_id FROM signals WHERE topic = 'Hermes Validation Signal' ORDER BY created_at DESC LIMIT 1;"
```

The dashboard will show `Hermes Validation Signal` with Hermes attribution in the Daily Brief / Signal Explorer.

## Morning Verification

After scheduled Hermes jobs run, use:

```bash
npm run verify:hermes-morning
```

The verification checks backend health, Hermes health, today’s signals, recent audit events, validation attribution, and morning digest attribution. If the scheduled morning digest has not appeared yet, it prints:

```text
Morning digest not yet observed
```

Tomorrow morning checklist:

1. Confirm the backend is running.
2. Run `npm run verify:hermes-morning`.
3. Confirm the latest validation signal has provider, model, endpoint, and job name.
4. Confirm the latest `morning_digest` signal has provider, model, endpoint, and job name.
5. Confirm recent audit events include Hermes import activity.
6. Open the dashboard and verify the Daily Brief contains the Hermes morning signal.

## Velocity Alerts

Phase 4F adds a deterministic Velocity Alert Engine. It does not gather more stories; it compares signal snapshots over time to identify topics gaining momentum.

The engine tracks:

- source count delta
- priority score delta
- velocity score delta

Alert levels:

- `watch`: acceleration score >= 60
- `rising`: acceleration score >= 75
- `viral_window`: acceleration score >= 90

Read alerts:

```bash
curl http://127.0.0.1:3000/api/velocity-alerts
curl "http://127.0.0.1:3000/api/velocity-alerts?level=rising"
curl "http://127.0.0.1:3000/api/velocity-alerts?personaId=policy-pete"
curl http://127.0.0.1:3000/api/velocity/latest
```

Verify the engine:

```bash
npm run verify:velocity
```

The engine is RSS/news-first today and X-ready later. Future X inputs can add `xPostCount15m`, `xPostCount60m`, `xUniqueAuthors`, `xHighFollowerAuthors`, and `xEngagementRate` without changing the alert object shape.

## Hermes Simulation

Version 1 simulation mode remains available for wiring validation. It should not be the production morning digest source now that the provider-backed route exists.

```bash
curl -X POST http://127.0.0.1:3000/api/hermes/simulate \
  -H 'content-type: application/json' \
  -d '{"runType":"morning_digest"}'
```

Supported simulated run types:

- `morning_digest`
- `velocity_scan`
- `midday_brief`
- `evening_scan`

## Signal Lifecycle

Signals support:

- `new`
- `reviewed`
- `used`
- `dismissed`
- `archived`

Archive old signals:

```bash
curl -X POST http://127.0.0.1:3000/api/signals/archive \
  -H 'content-type: application/json' \
  -d '{"days":7}'
```

Archived signals remain in SQLite and leave the main review flow.

## Phase 5 Local Operator Loop

Phase 5 keeps Persona Command Center local-first for X account management. It does not require X credentials, does not call the X API, and does not publish externally. Operators can review signals, generate drafts, approve or reject drafts with reasons, prepare scheduled posts, manually mark a prepared post as published after posting outside the app, and enter performance numbers by hand.

Local workflow:

```text
signal review
  -> draft generation / edit
  -> optional A/B draft choice
  -> X quality check
  -> approve or reject with reason
  -> schedule preparation
  -> manual mark-as-published
  -> manual performance capture
  -> operator queue summary
```

Review reasons:

```bash
curl -X POST http://127.0.0.1:3000/api/signals/SIGNAL_ID/mark-reviewed \
  -H 'content-type: application/json' \
  -d '{"reason":"Relevant and safe for today."}'

curl -X POST http://127.0.0.1:3000/api/signals/SIGNAL_ID/dismiss \
  -H 'content-type: application/json' \
  -d '{"reason":"Duplicate or too stale."}'
```

Draft approval and rejection reasons:

```bash
curl -X POST http://127.0.0.1:3000/api/drafts/DRAFT_ID/approve \
  -H 'content-type: application/json' \
  -d '{"reason":"Ready for manual scheduling."}'

curl -X POST http://127.0.0.1:3000/api/drafts/DRAFT_ID/reject \
  -H 'content-type: application/json' \
  -d '{"reason":"Needs a stronger hook."}'
```

Draft responses include `qualityChecks`, a local X readiness check for character count, empty copy, links, hashtag volume, and high-claim terms. These checks are advisory and do not call X.

Operator A/B draft choice:

The Operator screen shows Draft A and Draft B when two usable local variants exist for a persona. If only one variant exists, the card stays in single recommended draft mode. The operator can choose `A`, `B`, or `neither`, make a brief edit in the final text box, then use `Mark Sent`, `Send Later`, or `Skip`. Each choice is stored locally so future tuning can learn which draft style won.

```bash
curl -X POST http://127.0.0.1:3000/api/operator/draft-choices \
  -H 'content-type: application/json' \
  -d '{
    "personaId":"policy-pete",
    "signalId":"SIGNAL_ID",
    "sourceSignalIds":["SIGNAL_ID"],
    "draftA":"Draft A copy",
    "draftB":"Draft B copy",
    "selectedVariant":"B",
    "editedFinalText":"Final human-edited copy",
    "choiceReason":"Sharper hook.",
    "outcome":"recorded"
  }'
```

After a local schedule, publish, or skip action, update the same choice with the outcome:

```bash
curl -X PATCH http://127.0.0.1:3000/api/operator/draft-choices/CHOICE_ID/outcome \
  -H 'content-type: application/json' \
  -d '{"outcome":"scheduled","scheduledPostId":"POST_ID","editedFinalText":"Final human-edited copy"}'
```

Manual mark-as-published:

```bash
curl -X POST http://127.0.0.1:3000/api/schedule/POST_ID/mark-published \
  -H 'content-type: application/json' \
  -d '{
    "publishedUrl":"https://x.local/manual/post",
    "publishedAt":"2026-06-18T14:00:00.000Z",
    "engagementNotes":"Posted manually; no X API call made."
  }'
```

Manual performance capture:

```bash
curl -X PATCH http://127.0.0.1:3000/api/published-posts/PUBLISHED_POST_ID/performance \
  -H 'content-type: application/json' \
  -d '{
    "impressions":1200,
    "likes":84,
    "reposts":11,
    "replies":5,
    "bookmarks":17,
    "notes":"Metrics entered manually from the X UI."
  }'
```

Read the local ledger and queue:

```bash
curl http://127.0.0.1:3000/api/published-posts
curl http://127.0.0.1:3000/api/operator/draft-choices
curl http://127.0.0.1:3000/api/operator/queue
```

Verify the Phase 5 loop:

```bash
npm run verify:phase5
npm run verify:x-api-readiness
```

The X API readiness report is maintained at [docs/x-api-readiness-report.md](docs/x-api-readiness-report.md). It lists what is complete, what remains manual, future environment variables, required future scopes, the integration sequence once credentials exist, and remaining risks before real X integration.

## Score History

Every Hermes import or duplicate update writes a `signal_snapshots` row containing:

- captured date
- priority score
- velocity score
- freshness score
- relevance score
- novelty score
- risk score

Inspect one signal’s history:

```bash
curl http://127.0.0.1:3000/api/signals/SIGNAL_ID/history
```

The frontend includes a simple Signal History table. No charts are added.

## RSS/News Ingestion

The Phase 3 public-feed ingestion remains available:

```bash
curl -X POST http://127.0.0.1:3000/api/ingestion/run
```

Deterministic local run:

```bash
curl -X POST http://127.0.0.1:3000/api/ingestion/run \
  -H 'content-type: application/json' \
  -d '{"useMockProviders":true}'
```

## Inspect SQLite Data

```bash
sqlite3 data/persona-command-center.sqlite
```

Useful checks:

```sql
.tables
SELECT key, value FROM hermes_settings;
SELECT persona_id, topic, generated_by, hermes_run_type, priority_score, status FROM signals ORDER BY priority_score DESC LIMIT 12;
SELECT signal_id, captured_at, priority_score, velocity_score, freshness_score FROM signal_snapshots ORDER BY captured_at DESC LIMIT 20;
SELECT run_type, generated_by, source_count, candidate_count, cluster_count, signal_count, status FROM ingestion_runs ORDER BY started_at DESC LIMIT 5;
SELECT action, entity_type, entity_id, created_at FROM audit_log ORDER BY created_at DESC LIMIT 20;
```

## API Routes

- `GET /api/health`
- `GET /api/setup/status`
- `POST /api/setup/reset-personas`
- `GET /api/personas`
- `POST /api/personas/initialize`
- `GET /api/personas/:id`
- `POST /api/personas/:id`
- `PATCH /api/personas/:id`
- `POST /api/personas/:id/queries`
- `PATCH /api/personas/:id/queries/:queryId`
- `DELETE /api/personas/:id/queries/:queryId`
- `PATCH /api/personas/:id/queries/:queryId/toggle`
- `GET /api/signals`
- `GET /api/signals/today`
- `GET /api/signals/persona/:personaId`
- `GET /api/signals/:id/history`
- `GET /api/velocity-alerts`
- `GET /api/velocity/latest`
- `GET /api/operator/queue`
- `PATCH /api/signals/:id`
- `POST /api/signals/:id/dismiss`
- `POST /api/signals/:id/mark-reviewed`
- `POST /api/signals/archive`
- `POST /api/hermes/import`
- `GET /api/hermes/export`
- `POST /api/hermes/validate`
- `GET /api/hermes/health`
- `POST /api/hermes/morning-digest/run`
- `GET /api/hermes/morning-digest/latest`
- `POST /api/hermes/simulate`
- `GET /api/hermes/settings`
- `PATCH /api/hermes/settings`
- `POST /api/ingestion/run`
- `GET /api/ingestion/runs`
- `GET /api/drafts`
- `POST /api/drafts/generate`
- `PATCH /api/drafts/:id`
- `POST /api/drafts/:id/approve`
- `POST /api/drafts/:id/reject`
- `POST /api/drafts/:id/regenerate`
- `GET /api/schedule`
- `POST /api/schedule`
- `PATCH /api/schedule/:id`
- `POST /api/schedule/:id/cancel`
- `POST /api/schedule/:id/mark-published`
- `GET /api/published-posts`
- `POST /api/published-posts`
- `PATCH /api/published-posts/:id/performance`
- `GET /api/operator/draft-choices`
- `POST /api/operator/draft-choices`
- `PATCH /api/operator/draft-choices/:id/outcome`
- `GET /api/audit-log?limit=50`

## Code Layout

- `src/hermes/hermesClient.js`
- `src/hermes/hermesJobs.js`
- `src/hermes/hermesImport.js`
- `src/hermes/chiefOfStaff.js`
- `src/hermes/providerMorningDigest.js`
- `src/hermes/validationJob.js`
- `src/velocity/snapshotEngine.js`
- `src/velocity/accelerationEngine.js`
- `src/velocity/alertEngine.js`
- `scripts/hermes-validation-job.js`
- `scripts/run-provider-morning-digest.js`
- `scripts/verify-persona-persistence.js`
- `scripts/verify-velocity-engine.js`
- `scripts/verify-phase-5-operator-loop.js`
- `scripts/verify-x-api-readiness.js`
- `src/providers/rssProvider.js`
- `src/providers/newsProvider.js`
- `src/providers/mockProvider.js`
- `src/ingestion/dedupe.js`
- `src/ingestion/cluster.js`
- `src/ingestion/scoring.js`
- `src/ingestion/angleEngine.js`
- `src/ingestion/pipeline.js`
- `docs/hermes-contract.md`
- `docs/x-api-readiness-report.md`

## Future Integration Points

- Real Hermes cron should call `POST /api/hermes/morning-digest/run` for provider-backed briefings.
- Real Hermes can still call `POST /api/hermes/import` when it has a complete validated payload.
- X API recent search can be added as a future provider.
- X velocity metrics can feed the velocity engine through the future-compatible acceleration input shape.
- X publishing should connect only after the local Phase 5 published-post ledger and manual performance loop are proven.
- Instagram, YouTube, and TikTok adapters should consume normalized scheduled post records later.
- Scoring can evolve to include source trust, richer entity extraction, editorial safety review, and historical trend baselines.

## Verification

```bash
npm run build
npm run typecheck
npm test
npm run verify:first-run-setup
npm run verify:persona-persistence
npm run verify:velocity
npm run verify:phase5
npm run verify:x-api-readiness
npm run hermes:morning-digest
npm run verify:digest-quality
npm run verify:hermes-morning
```

`npm test` runs a smoke test against a temporary SQLite database. It verifies Hermes export, validation import, model attribution, persistent persona editing, persona query create/update/toggle/delete, provider-backed morning digest, velocity alert creation, acceleration scoring, 72-hour freshness filtering, mock-source rejection, compact digest output, Chief of Staff selection, morning digest attribution inheritance, signal-level attribution overrides, health, validation audit events, simulation mode, duplicate detection, archive workflow, score history creation, RSS parsing, deduplication, clustering, scoring, draft review, scheduling, and persona persistence.

`npm run verify:phase5` verifies the complete local operator loop, including review reasons, X draft checks, lifecycle gates, manual publish idempotency, performance capture, used-signal history, and operator queue output. `npm run verify:x-api-readiness` verifies the pre-X contract: no runtime X credential requirement, no X/Twitter API calls, readiness documentation, future environment variable documentation, future scopes, and integration sequence.
