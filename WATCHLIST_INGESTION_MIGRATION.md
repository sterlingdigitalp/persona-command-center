# Watch List Ingestion Migration

## Summary

Replaced the production Opportunity Engine input source from `persona_queries` (legacy static text queries) to `tracked_entities` + `persona_entity_subscriptions` (Watch List entities).

## Legacy Path Removed

### Old: `persona_queries` → ingestion

```
Persona
↓
persona_queries (static text)
↓
Opportunity Engine (collectPersonaCandidates)
↓
Provider dispatch (RSS, News, Mock, X, etc.)
```

The `collectPersonaCandidates()` function in `src/ingestion/pipeline.js` read `persona.queries` — static text strings from the `persona_queries` table. Each query was dispatched to providers as a search term.

### New: `tracked_entities` → ingestion

```
Persona
↓
tracked_entities + persona_entity_subscriptions (Watch List)
↓
persona_rss_topics (Topic Monitoring — secondary)
↓
persona_crawl_targets (Authoritative Sources — tertiary)
↓
Opportunity Engine (collectPersonaCandidates)
↓
Provider dispatch (RSS, News, Mock, X, etc.)
```

`collectPersonaCandidates()` now reads `persona.trackedEntities`. For each entity subscription, query configs are built based on active monitor flags:
- `monitor_x` → X handle as query for X provider
- `monitor_mentions` → X handle for mentions tracking
- `monitor_rss` → entity name as query for RSS + News providers
- `monitor_crawl4ai` → entity name for crawl4ai provider
- `monitor_searchagent` → entity name for search agent

`persona.rssTopics` (Topic Monitoring) and `persona.crawlTargets` (Authoritative Sources) are preserved as secondary/tertiary sources.

If no Watch List, topics, or crawl targets exist, `persona.niche` is used as fallback.

## Files Changed

| File | Change |
|------|--------|
| `src/ingestion/pipeline.js:11-83` | `collectPersonaCandidates()` rewritten to read `trackedEntities`, `rssTopics`, `crawlTargets` instead of `persona.queries` |
| `src/hermes/hermesJobs.js:77` | `buildHermesSimulationPayload()` prefers tracked entity name for signal query field |
| `src/hermes/validationJob.js:38` | `buildValidationPayload()` prefers tracked entity name for signal query field |
| `tests/smoke-test.js:531-532` | Updated assertion: digest now proves Watch List entities used instead of persona_queries |
| `tests/smoke-test.js:147-152` | Updated crawl4ai test: now returns mock results instead of throwing NotImplemented |
| `package.json` | Added `verify:watchlist-ingestion` script |

## Not Changed

- Database schema (`src/db.js`)
- Persona UI (`outputs/persona-command-center.html`)
- Hermes cron / scheduling
- Opportunity Packet schema (signals table)
- Draft generation
- Operator page
- Delivery pipeline (`importHermesPayload`)
- Hermes export (`/api/hermes/export`) — unchanged, still includes both `trackedEntities` and `personaQueries`
- `persona_queries` CRUD routes — untouched, backward compatible
