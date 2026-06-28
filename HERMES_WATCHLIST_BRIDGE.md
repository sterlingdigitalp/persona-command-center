# Phase 5B.3 — Hermes Watch List Bridge

## Architecture

```
PCC (JavaScript)                    SearchAgent (Python)               PCC (JavaScript)
┌─────────────────────┐            ┌─────────────────────────┐       ┌─────────────────────┐
│ Personas             │            │ watch_list_processor.py │       │ /api/hermes/import   │
│ Watch Lists          │──GET─────→│                         │──────→│                     │
│ Topics               │ /api/     │ 1. Parse export         │POST   │ 4 signals imported   │
│ Authoritative Sources│ hermes/   │ 2. For each entity:     │ /api/ │ → signals table       │
│                      │ export    │    a. SearchAgent.search │ hermes/│ → ingestion_runs      │
│ stored in SQLite     │           │    b. SearchAgent.research│import │ → operator queue      │
│                      │           │ 3. Create Opportunity    │       └─────────────────────┘
│ /api/hermes/export   │           │    Packet per entity     │
│ returns 4 personas   │           │ 4. Generate 3 suggested   │
│ + 40 tracked entities│           │    posts (via PCC import) │
└─────────────────────┘            └─────────────────────────┘
```

## Production Flow

1. **Hermes cron** (06:30 ET morning digest) invokes `watch_list_processor.py --production`
2. Bridge fetches `GET /api/hermes/export` from local PCC backend
3. For each tracked entity with `monitor_x = true`:
   - Calls `SearchAgent.search()` (SearXNG web search → X.com results)
   - Falls back to `SearchAgent.research()` (deeper analysis pipeline)
   - Falls back to `SearchAgent.fetch_platform()` (X URL extraction via CLI tools)
4. Builds Hermes-compatible import payload with:
   - `source: "hermes_x_search"`
   - `sourceProvider: "SearchAgent"`
   - `runType: "morning_digest"` (production) or `"trial_push"` (trial)
5. POSTs payload to `POST /api/hermes/import`
6. PCC imports signals, creates ingestion run, updates operator queue

## Bridge Script

**Path:** `/Users/sterlingdigital/hermes-peptide-intelligence/search_agent/services/watch_list_processor.py`

**Entry point:**
```bash
# Trial mode (4 entity mappings)
python3 /path/to/watch_list_processor.py --trial

# Production mode (all active entities with monitor_x=true)
python3 /path/to/watch_list_processor.py --production

# With custom PCC URL
python3 /path/to/watch_list_processor.py --trial --pcc-base-url http://localhost:3000
```

**Key functions:**
- `PCCClient()` — HTTP client for PCC backend (export, import, operator queue)
- `search_agent_x_retrieve(entity_name, handle)` — tries SearchAgent.search → .research → .fetch_platform
- `build_import_payload(persona_id, entity_name, handle, retrieval_result, run_type, test_mode)` — constructs Hermes-compatible import payload
- `run_bridge(pcc, trial)` — orchestrates the full bridge pipeline

## Trial Mode Mappings

| Persona ID | Persona Name | Entity | Handle |
|---|---|---|---|
| policy-pete | Sterling Digital | Paul Graham | @paulg |
| maga-memester | Scott Decoded | Andrej Karpathy | @karpathy |
| the-wonkette | Peptide Tracker | Bryan Johnson | @bryan_johnson |
| progressive-pat | Chris Klebl | Morgan Housel | @morganhousel |

## PCC Changes

| File | Change |
|------|--------|
| `src/hermes/hermesClient.js` | Added `trial_push` to valid `RUN_TYPES` |
| `package.json` | Added `verify:hermes-watchlist-bridge` script |

No other PCC changes were needed. PCC does not acquire X API credentials, does not call `api.twitter.com/2`, and does not run the X provider in the production bridge path.

## Verification

`npm run verify:hermes-watchlist-bridge` — 19 checks:
- PCC export readable ✓
- 4 personas loaded ✓
- 40 tracked entities loaded ✓
- Hermes/SearchAgent X retrieval invoked ✓
- PCC-side X provider NOT used ✓
- Trial push: 4+ trial_push ingestion runs ✓
- Entity mapping correct (all 4 pairs) ✓
- Operator queue shows persona data ✓
- No mock_x used ✓
- Bridge import source is SearchAgent ✓

## Cron Integration

The morning digest cron (`persona-command-center-morning-digest`) is updated to invoke:
```
python3 /Users/sterlingdigital/hermes-peptide-intelligence/search_agent/services/watch_list_processor.py --production
```
as the second stage after the provider-backed digest, or as a standalone pipeline. This replaces the need for PCC-side X API calls in the production path.
