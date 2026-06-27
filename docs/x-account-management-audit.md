# X Account Management Audit

Audit date: 2026-06-18

## Executive Summary

Persona Command Center is already a credible local operating console for X account management up through signal discovery, digest selection, draft review, and schedule preparation. It is not yet an X-connected publishing or analytics app, and it should not connect to Director Desk for the next phase.

The highest-ROI next phase is **Phase 5: Review-to-Schedule Operating Loop**. This should turn the existing signal, draft, schedule, audit, and velocity pieces into a more complete daily workflow: queue prioritized opportunities, generate and edit X-safe drafts, approve/reject with reasons, prepare scheduled posts, manually mark posts as published, and record lightweight performance feedback. This creates immediate value without needing X credentials, reduces risk before publishing automation, and gives a clean data model for later X API integration.

An X API key is **not needed now**. It is needed later for recent-search ingestion, publishing, and real engagement metrics. The app can move substantially forward first by improving local review, manual publish tracking, and feedback capture.

## Current Capabilities

### Persona Configuration

What works:

- SQLite-backed personas, X handles, niches, voice/tone, platform status, and active search terms exist in `personas`, `persona_queries`, and `platform_accounts`.
- First-run setup requires four personas with handle, niche, voice/tone, and at least three search terms.
- Persona edits, query creation, query updates, toggles, and deletion are persisted and protected from seed overwrite.
- Active personas and active queries feed provider-backed morning digest runs without server restart.

Supporting files, scripts, and endpoints:

- `db/schema.sql`: `personas`, `persona_queries`, and `platform_accounts`.
- `src/server.js`: `GET /api/setup/status`, `POST /api/personas/initialize`, `GET /api/personas`, `GET /api/personas/:id`, `PATCH /api/personas/:id`, `POST /api/personas/:id/queries`, `PATCH /api/personas/:id/queries/:queryId`, `PATCH /api/personas/:id/queries/:queryId/toggle`, `DELETE /api/personas/:id/queries/:queryId`.
- `src/db.js`: idempotent schema setup, seed insert-only behavior, seed overwrite protection, and migrations.
- `scripts/verify-first-run-persona-setup.js`, `scripts/verify-persona-persistence.js`, `scripts/verify-persona-data-protection.js`, `scripts/verify-persona-routes.js`, `scripts/verify-all-persona-saves.js`, `scripts/verify-frontend-save-path.js`.

Missing or weak:

- No per-persona publishing permissions, approval policies, rate limits, posting windows, content rules, media requirements, or account health fields.
- `platform_accounts` stores placeholders, but there is no credential readiness state beyond `status` and `adapter_notes`.

### Signal Ingestion

What works:

- Public-feed ingestion supports RSS/news providers, mock providers for test/dev, candidate collection, dedupe, clustering, scoring, suggested angles, signal persistence, and ingestion run summaries.
- Provider-backed morning digest uses active personas, active queries, freshness filtering, mock-source blocking, stale/update/archive marker rejection, dedupe, clustering, scoring, and deterministic selection.
- Hermes import can ingest external payloads, validate structure, deduplicate recent signals, update duplicates, create snapshots, and write audit events.

Supporting files, scripts, and endpoints:

- `src/ingestion/pipeline.js`: candidate collection, dedupe, cluster, score, angle generation.
- `src/ingestion/freshnessFilter.js`: 72-hour freshness rules, mock-source rejection, stale marker rejection.
- `src/ingestion/dedupe.js`, `src/ingestion/cluster.js`, `src/ingestion/scoring.js`, `src/ingestion/angleEngine.js`, `src/ingestion/text.js`.
- `src/hermes/hermesImport.js`: Hermes payload validation/import, duplicate handling, snapshot creation, velocity alert generation.
- `src/hermes/providerMorningDigest.js`: provider-backed morning digest orchestration.
- `src/hermes/chiefOfStaff.js`: top signal selection with duplicate and risk filtering.
- `src/server.js`: `POST /api/ingestion/run`, `GET /api/ingestion/runs`, `POST /api/hermes/import`, `POST /api/hermes/morning-digest/run`, `GET /api/hermes/morning-digest/latest`, `POST /api/hermes/simulate`.
- `scripts/run-provider-morning-digest.js`, `scripts/check-latest-digest.js`, `scripts/verify-digest-quality.js`, `scripts/hermes-validation-job.js`, `scripts/hermes-morning-verification.js`.

Missing or weak:

- No X recent-search provider yet.
- No source trust calibration, entity extraction, watchlists, topic suppression, or operator feedback in scoring.
- No hosted scheduler; README documents local cron/operator commands.

### Digest Generation

What works:

- Provider-backed morning digest is the recommended production-style digest path.
- It returns latest digest metadata and compact verification output.
- It records attribution: provider, model, endpoint, and job name.
- Quality verification checks freshness, selected signal count, mock-source exclusion, stale marker exclusion, and provider names.

Supporting files, scripts, and endpoints:

- `src/hermes/providerMorningDigest.js`.
- `src/hermes/chiefOfStaff.js`.
- `src/server.js`: `POST /api/hermes/morning-digest/run`, `GET /api/hermes/morning-digest/latest?compact=true`.
- `scripts/run-provider-morning-digest.js`.
- `scripts/verify-digest-quality.js`.
- `README.md`: Provider-Backed Morning Digest, Freshness rules, Morning Verification.

Missing or weak:

- Digest generation selects opportunities but does not produce an operator-ready action plan with recommended draft count, timing, priority reason, or review state.
- Midday/evening jobs exist as Hermes run types and simulation/import paths, but the provider-backed path is strongest for morning digest only.

### Draft Creation And Review

What works:

- Draft records exist with body, original body, edited body, platform, hashtags, status, media refs, and source signal IDs.
- Draft generation can create two to three X-platform drafts from selected signals or top persona signals.
- Drafts can be edited, approved, rejected, and regenerated.
- Approving a draft marks source signals as used.

Supporting files, scripts, and endpoints:

- `db/schema.sql`: `drafts`.
- `src/server.js`: `GET /api/drafts`, `POST /api/drafts/generate`, `PATCH /api/drafts/:id`, `POST /api/drafts/:id/approve`, `POST /api/drafts/:id/reject`, `POST /api/drafts/:id/regenerate`.
- `tests/smoke-test.js`: covers draft review as part of `npm test`.

Missing or weak:

- Draft generation is template-based, not LLM-backed and not deeply voice-aware beyond persona fields and suggested angle.
- No X character-limit validation, thread handling, quote-post/reply mode, link/media validation, claim checking, compliance review, or approval notes.
- No rejection reasons or revision history beyond `original_body`/`edited_body`.

### Scheduling Preparation

What works:

- Scheduled post records exist for prepared X posts.
- A draft can be converted into a scheduled post.
- Scheduled posts can be edited or cancelled.
- Scheduling marks source signals as used and updates draft status to `scheduled`.

Supporting files, scripts, and endpoints:

- `db/schema.sql`: `scheduled_posts`, `idx_schedule_status`.
- `src/server.js`: `GET /api/schedule`, `POST /api/schedule`, `PATCH /api/schedule/:id`, `POST /api/schedule/:id/cancel`.
- `tests/smoke-test.js`: covers scheduling as part of `npm test`.

Missing or weak:

- This is schedule preparation only. There is no publisher, no X post ID, no posted timestamp, no publish failure handling, and no platform response storage.
- No queue calendar, per-persona posting cadence, conflict detection, or optimal-time suggestions.

### X API Readiness

What works:

- The data model already assumes platform `x` for drafts and scheduled posts.
- Personas store X handles, and platform account placeholders exist.
- README explicitly identifies X recent search and X publishing as future phases.
- Velocity code includes a future-compatible input shape for X metrics.

Supporting files, scripts, and endpoints:

- `db/schema.sql`: `platform_accounts`, `drafts.platform`, `scheduled_posts.platform`.
- `src/server.js`: `runIngestion` comment notes X API recent search and publishing remain future phases.
- `src/velocity/accelerationEngine.js`: `calculateFutureXAcceleration` includes `xPostCount15m`, `xPostCount60m`, `xUniqueAuthors`, `xHighFollowerAuthors`, and `xEngagementRate`.
- `README.md`: Future Integration Points.

Missing or weak:

- No OAuth/token model, no X API client, no credential validation, no recent-search adapter, no media upload adapter, no publishing adapter, no rate-limit handling, and no webhook/polling plan.
- No abstraction boundary for publishing outcomes yet.

### Published-Post Tracking

What works:

- There is a local `scheduled_posts` table and lifecycle support for `scheduled` and `cancelled`.
- Drafts and signals can be marked as used when scheduled or approved.

Supporting files, scripts, and endpoints:

- `db/schema.sql`: `scheduled_posts`, `signals.used_at`, draft statuses.
- `src/server.js`: `createScheduledPost`, `markSignalsUsed`, `updateScheduledPost`, `cancelScheduledPost`.
- `GET /api/schedule`, `POST /api/schedule`, `PATCH /api/schedule/:id`, `POST /api/schedule/:id/cancel`.

Missing or weak:

- No `published_posts` table.
- No X post ID, published URL, actual published body, publish timestamp, manual publish confirmation, or publish status history.
- No way to connect a scheduled post to measured performance.

### Performance And Feedback Loop

What works:

- Signals have score history through `signal_snapshots`.
- Velocity alerts can flag `watch`, `rising`, and `viral_window` topics based on source count, priority, and velocity deltas.
- Audit logging captures major workflow events.
- Signal lifecycle supports `new`, `reviewed`, `used`, `dismissed`, and `archived`.

Supporting files, scripts, and endpoints:

- `db/schema.sql`: `signal_snapshots`, `velocity_alerts`, `audit_log`.
- `src/velocity/snapshotEngine.js`, `src/velocity/accelerationEngine.js`, `src/velocity/alertEngine.js`.
- `src/server.js`: `GET /api/velocity-alerts`, `GET /api/velocity/latest`, `GET /api/signals/:id/history`, `GET /api/audit-log?limit=50`.
- `scripts/run-velocity-scan.js`, `scripts/verify-velocity-engine.js`.

Missing or weak:

- No post-level performance metrics.
- No operator feedback fields such as why a signal was dismissed, why a draft was rejected, what performed, or what voice/angle worked.
- Scoring does not learn from published outcomes or manual ratings.

## Key Risks

- **Publishing risk is premature.** The app can prepare posts but has no published-post ledger, no manual confirmation workflow, and no failure/status model. Adding X publish now would attach credentials to an incomplete operating loop.
- **Draft quality risk.** Current drafts are deterministic templates. They are useful placeholders, not final social copy quality control.
- **Freshness dependence.** Digest quality depends on provider timestamps and stale-marker heuristics. This is good enough for RSS/news, but still needs operator review.
- **Credential/security risk.** There is no authentication, no secret storage model, and no account permission model.
- **Analytics gap.** Without published-post tracking and performance capture, the app cannot learn which signals, angles, or personas work.
- **Workflow ambiguity.** Signals, drafts, and scheduled posts exist, but the product does not yet enforce a clear daily queue from digest to reviewed signal to draft to scheduled/published outcome.

## Recommended Phase 5

Recommended name: **Phase 5: Review-to-Schedule Operating Loop**.

Build this before Director Desk and before X API integration.

Phase 5 should include:

1. Add a local publishing ledger.
   - Add `published_posts` or extend schedule state with publish-specific fields: `scheduled_post_id`, `persona_id`, `platform`, `external_post_id`, `published_url`, `published_at`, `published_body`, `status`, `source_signal_ids`, `performance_summary`, `created_at`, `updated_at`.
   - Support manual mark-as-published without calling X.

2. Add review metadata.
   - Signal dismiss/review reason.
   - Draft approve/reject reason.
   - Draft quality checks for X length, empty media refs, links, hashtags, and risky terms.

3. Add an operator queue endpoint.
   - One endpoint that returns today’s recommended work by persona: top signals, velocity alerts, existing drafts, scheduled posts, and gaps.
   - Suggested endpoint: `GET /api/operator/queue`.

4. Add manual performance capture.
   - Allow the operator to enter impressions, likes, reposts, replies, bookmarks, URL, and notes after a post is manually published.
   - Suggested endpoints: `POST /api/published-posts`, `PATCH /api/published-posts/:id/performance`, `GET /api/published-posts`.

5. Add feedback summaries.
   - Summarize which personas, queries, topics, and angles produced scheduled/published outcomes.
   - Feed these summaries into future scoring without needing X API yet.

6. Add focused verification.
   - Verify signal-to-draft-to-schedule-to-manual-publish lifecycle.
   - Verify manual performance capture.
   - Verify no X credentials or external publish calls are required.

Why this is the highest-ROI next phase:

- It converts existing persistence and workflows into a complete daily X management loop.
- It creates the data model X integration will need later.
- It avoids spending time on API keys before the app can safely account for published outcomes.
- It improves decision quality with manual feedback now, then real X metrics later.

## X API Key Recommendation

Do not request or wire an X API key in Phase 5.

Use an X API key later when the app has:

- A published-post ledger.
- Manual publish confirmation.
- Draft/schedule quality checks.
- A status model for `scheduled`, `ready_to_publish`, `published`, `failed`, and `cancelled`.
- Performance fields ready to receive X metrics.
- Credential storage and account permission boundaries.

Likely later uses:

- Recent-search ingestion provider.
- Post publishing.
- Published-post lookup and metric refresh.
- Rate-limit-aware account health checks.

## Recommended Next Prompt

Implement Phase 5 for Persona Command Center without X API integration or Director Desk. Add local published-post tracking, manual mark-as-published, manual performance capture, review/rejection reasons, X draft quality checks, and an operator queue endpoint that connects signals, velocity alerts, drafts, schedules, and published outcomes. Update README and tests, then run `npm run typecheck`, `npm run test`, `npm run verify:digest-quality`, and `npm run verify:velocity`.
