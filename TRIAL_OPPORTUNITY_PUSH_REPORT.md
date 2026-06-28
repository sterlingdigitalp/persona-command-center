# Trial Opportunity Push Report

## Run Details

| Field | Value |
|-------|-------|
| Run Type | `validation_ping` |
| Run ID | `run_90fb7bac-1826-4575-8f8d-74d36d9a950b` |
| Job | `pcc-hermes-data-flow-validation` |
| Timestamp | `2026-06-28T02:47:22.571Z` |
| Mode | `testMode: true`, no external publishing |

## Trial Signals

| Persona | Entity | Topic | Score |
|---------|--------|-------|-------|
| Sterling Digital | Paul Graham | Paul Graham on startup fundraising in 2026 | 82 |
| Scott Decoded | Andrej Karpathy | Karpathy on LLM training efficiency breakthroughs | 82 |
| Peptide Tracker | Bryan Johnson | Bryan Johnson on new longevity clinical trial results | 82 |
| Chris Klebl | Morgan Housel | Morgan Housel on behavioral investing in volatile markets | 82 |

## Results

- **4 new signals created**, 0 updated
- All signals appear in `GET /api/operator/queue` under their respective personas
- All signals have `hermes_run_type: "validation_ping"` and `source_provider: "mock_x"`
- Velocity alerts generated for all 4 signals

## Import Path

Signals were injected via the production Hermes import pipeline (`POST /api/hermes/import`), which performs:
- Payload validation (`validateHermesPayload`)
- Signal normalization (`normalizeHermesSignal`)
- Deduplication against recent signals (`loadRecentSignalsByPersona`)
- Persistence to `signals` table
- Snapshot capture in `signal_snapshots`
- Velocity alert generation
- Audit logging

## Ingestion Run Record

The import was recorded in `ingestion_runs` with status `completed` and a dedicated audit log entry marked as `hermes_validation_imported`.

## Notes

- Trial signals were sourced from mock provider since X provider is stub-only
- No automated retrieval pipeline was exercised — signals were constructed manually against known Watch List entities
- Dashboard rendering of trial signals was not visually verified (API-level validation only)
