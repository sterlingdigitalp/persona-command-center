# Phase 5A.3 — Persona Intelligence Configuration Redesign

## Status: DELIVERED ✓

## Summary

Implemented a complete redesign of the Persona Intelligence Configuration system. The flat persona schema has been extended with four new relational data models (interests, tracked entities, crawl targets, RSS/news topics), backend CRUD endpoints, a redesigned Personas tab UI, seed data for Andrej Karpathy, and contract documentation.

## What Was Done

### Part 1 — Data Model (Schema + Migration)
- **New tables** (added to `db/schema.sql`): `persona_interests`, `tracked_entities`, `persona_entity_subscriptions`, `persona_crawl_targets`, `persona_rss_topics` with proper FKs, indexes, and defaults
- **Migration** (added to `src/db.js:runMigrations()`): Creates new tables and copies existing `persona_queries` rows into `persona_rss_topics`
- **Non-destructive**: Existing `persona_queries` table and data are untouched

### Part 2 — Backend CRUD
- **Helper functions** in `src/server.js`: `getPersonaInterests()`, `getPersonaEntitySubscriptions()`, `getPersonaCrawlTargets()`, `getPersonaRssTopics()` — load config per persona
- **20 CRUD functions**: Full create/update/delete for all 5 tables (interests, entities, subscriptions, crawl targets, RSS topics)
- **Updated GET /api/personas**: Each persona now includes `interests`, `trackedEntities`, `crawlTargets`, `rssTopics` arrays
- **Updated GET /api/hermes/export**: Includes new config fields per persona + global `trackedEntities` list
- **15 route handlers**: Added to `routeApi()` for all new endpoints with JSON error handling

### Part 3 — UI Redesign (Personas Tab)
- **4 new sections** in each persona editor panel:
  - **Interests**: Label + weight display, add/remove via prompts
  - **Tracked Entities**: Entity name, type badge, priority input, 5 monitor channel checkboxes (X, Mentions, RSS, Crawl4AI, SearchAgent), remove
  - **RSS/News Topics**: Topic, provider badge, weight, remove (side by side with existing queries section)
  - **Crawl Targets**: Label, URL, frequency badge, remove
- **Event delegation**: Click/change handlers on `#personas` for all add/remove/update operations, calling REST API then `loadBackendData()`
- **No breaking changes**: Existing queries-section, persona-fields, and header are untouched. Dark mode preserved.

### Part 4 — Seed Data
- **12 persona_interests**: 3 per persona (Politics, Law & Courts, Campaign Finance for the-wonkette; Budget & Tax, Education, Healthcare for policy-pete; Media & Culture, Border Policy, Tech & Free Speech for maga-memester; Labor & Workers, Climate & Energy, Housing Justice for progressive-pat)
- **Tracked entity**: Andrej Karpathy (`ent-karpathy`) with aliases, GitHub, website, keywords, and X handle
- **Subscription**: progressive-pat subscribed to Andrej Karpathy with all 5 monitor channels enabled
- **3 crawl targets**: Karpathy Blog, OpenAI News, Anthropic News
- **All seed uses `ON CONFLICT(id) DO NOTHING`** — never overwrites user data

### Part 5 — Contract Documentation
- **`docs/entity-monitoring-contract.md`**: Documents data model, monitor channels (X, Mentions, RSS, Crawl4AI, SearchAgent), lifecycle, API endpoints, seed protection

### Part 7 — Verification
- **`scripts/verify-persona-intelligence-config.js`**: 36 checks covering:
  - Schema integration (each persona has all 4 new arrays)
  - CRUD operations (create/patch/delete for all 5 tables)
  - Seed entity presence and fields (Andrej Karpathy)
  - Entity subscriptions, crawl targets, interests per persona
  - Hermes export including new config fields

## Verification Results

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm test` | PASS (51 checks) |
| `verify:persona-routes` | PASS (22 checks) |
| `verify:persona-data-protection` | 1 pre-existing failure (unchanged) |
| `verify:phase-5-operator-loop` | PASS (36 checks) |
| `verify:persona-intelligence-config` | PASS (36 checks) |

## API Endpoints Added

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/entities` | List tracked entities |
| POST | `/api/entities` | Create tracked entity |
| PATCH | `/api/entities/:id` | Update tracked entity |
| DELETE | `/api/entities/:id` | Delete tracked entity |
| POST | `/api/personas/:id/interests` | Add interest to persona |
| PATCH | `/api/personas/:id/interests/:iid` | Update interest |
| DELETE | `/api/personas/:id/interests/:iid` | Remove interest |
| POST | `/api/personas/:id/entities` | Subscribe persona to entity |
| PATCH | `/api/personas/:id/entities/:sid` | Update subscription config |
| DELETE | `/api/personas/:id/entities/:sid` | Unsubscribe |
| POST | `/api/personas/:id/crawl-targets` | Add crawl target |
| PATCH | `/api/personas/:id/crawl-targets/:tid` | Update crawl target |
| DELETE | `/api/personas/:id/crawl-targets/:tid` | Remove crawl target |
| POST | `/api/personas/:id/rss-topics` | Add RSS/news topic |
| PATCH | `/api/personas/:id/rss-topics/:tid` | Update topic |
| DELETE | `/api/personas/:id/rss-topics/:tid` | Remove topic |

## Files Modified
- `db/schema.sql` — 5 new tables + indexes
- `db/seed.sql` — Interests, entities, subscriptions, crawl targets seed data
- `src/db.js` — Migration for new tables + persona_queries → persona_rss_topics copy
- `src/server.js` — 4 helpers, 20 CRUD functions, 15 routes, updated GET /api/personas, updated Hermes export
- `outputs/persona-command-center.html` — 4 new UI sections, CSS, event delegation for Personas tab
- `package.json` — typecheck includes new script, new `verify:persona-intelligence-config` script

## Files Created
- `docs/entity-monitoring-contract.md` — Contract documentation
- `scripts/verify-persona-intelligence-config.js` — 36-check verification suite

## Next Steps (Phase 5A.4 — Intelligence Provider Integration)
- X provider entity monitoring (monitor_x, monitor_mentions)
- Crawl4AI integration for crawl targets
- SearchAgent integration for tracked entities
- Intelligence Packet generation from entity data
