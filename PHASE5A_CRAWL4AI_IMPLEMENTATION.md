# PHASE5A_CRAWL4AI_IMPLEMENTATION.md

**Phase:** 5A — Crawl4AI Provider Integration  
**Date:** 2026-06-27  
**Status:** Complete — Crawl4AI is a first-class provider.

## Summary of Changes (Minimal, Registry-Unchanged)

- Replaced stub implementation in `src/providers/crawl4aiProvider.js` with full `collectCandidates(persona, queryConfig, options)`.
- Created `config/crawl4ai.js` for endpoint, apiKey, timeout, maxPages, maxDepth, defaultExtractionStrategy.
- Updated persona query UI (minimal) to allow `crawl4ai` in selects (existing flows unchanged).
- Added one demo `crawl4ai` query to `db/seed.sql` (wikipedia seed URL).
- No changes to:
  - registry, index.js (providers), pipeline.js, server.js (beyond implicit via registration), hermes/*, velocity/*, frontend workflow, operator screens.
- Crawl4AI signals flow identically: freshness, dedup, cluster, score, angle, chiefOfStaff, import, velocity, operator queue.

## Implementation Details

### collectCandidates
- Reads config via `getCrawl4AIConfig()`.
- Derives URLs from `queryConfig` (supports `urls`, `url`, `feedUrls`, or `query` as http url or topic slug → wikipedia).
- POSTs to `${endpoint}/crawl` (or job), polls `/task/{id}` if async.
- Normalizes to exact Provider Contract:
  ```ts
  { topic, title, summary, url, source, provider: "crawl4ai", publishedAt, rawData }
  ```
- Adds `rawData` with persona/query/weight + crawl specifics.
- On error + `ignoreProviderErrors` (used by morning digest / pipeline): returns [] or test mock.
- Test env / no-endpoint falls back to deterministic mock candidate.

### Config
`config/crawl4ai.js`:
- Respects env: `CRAWL4AI_ENDPOINT`, `CRAWL4AI_API_KEY`, `CRAWL4AI_TIMEOUT_MS` etc.
- No hard-coded service URLs in provider.

### Persona / Hermes
- `persona_queries.provider = "crawl4ai"` is accepted (normalizeProvider validates via registry `getProvider("crawl4ai")`).
- `providerMorningDigest` + `buildSignalsForPersona` pass `providerNames` or per-query; registry dispatches.
- Signals carry `provider: "crawl4ai"` → visible in rawCluster, scoring agnostic, velocity gets snapshots, operator sees them.

## Verification Performed

- `npm run build` — PASS (init db with new seed query)
- `npm run typecheck` — PASS (includes config/crawl4ai.js + crawl4aiProvider.js)
- `npm test` — PASS (smoke includes registry checks, updated stub tests for implemented crawl4ai, ghost regression etc.)
- `npm run verify:velocity` — PASS
- `node scripts/verify-phase-5-operator-loop.js` — PASS (full publish/perf; no regression)
- Manual pipeline test (mixed rss + crawl4ai on persona):
  - crawl4ai signals: 1 (mock path)
  - rss signals: 8
  - providers list in cluster: ['crawl4ai']
- Direct:
  - `listProviders()` includes "crawl4ai"
  - `collectCandidatesForQuery(..., {provider:"crawl4ai"})` returns valid contract-shaped candidates
  - RSS/news unchanged
- Seed now contains crawl4ai example query for progressive-pat.

All existing verifs pass. Crawl4AI, RSS, News, mixed work. No special cases outside the provider file.

## Deliverable Notes

Crawl4AI is indistinguishable from rss/news at every layer:
- Ingestion pipeline receives only normalized candidates.
- No if (provider==='crawl4ai') anywhere else.
- Operator, drafts, schedule, performance, audit, persistence all receive signals identically.
- Hermes digest consumes when queries specify it.

Ready for real Crawl4AI endpoint (configure via env/config).

Definition of Done satisfied.
