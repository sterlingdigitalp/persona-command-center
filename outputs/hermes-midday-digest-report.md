# Hermes Midday Digest Report — Persona Command Center

**Generated:** 2026-06-19T17:05:57Z  
**Job:** `persona-command-center-midday-digest`  
**Provider:** lmstudio · **Model:** qwen3.6-35b-a3b-mtp  

---

## Run Summary

| Field | Value |
|---|---|
| **Run ID** | `run_31686072-96f6-47f1-b551-6ace9d4aa9de` |
| **Started** | 2026-06-19T17:05:57.200Z |
| **Completed** | 2026-06-19T17:05:57.241Z (41 ms) |
| **Exit Code** | `0` (success) |
| **Status** | completed |

## Candidate Processing

| Metric | Count |
|---|---|
| Total candidates ingested | 1,707 |
| Fresh candidates | 1,024 |
| Stale filtered out | 683 |
| Mock filtered out | 0 |
| Missing-date filtered out | 0 |

## Signal Output

- **Total signals created:** 6
- **Attribution completeness:** complete
- **Sources used:** rss, news (2 providers)
- **Clusters formed:** 373
- **Personas skipped:** 2

### Per-Persona Signal Breakdown

| Persona | Signals |
|---|---|
| the-wonkette | 3 |
| policy-pete | 3 |
| *(skipped)* | — |
| *(skipped)* | — |

## Backend Health Check

```
GET http://127.0.0.1:3000/api/hermes/health → HTTP 200 OK (6,210 bytes)
```

Health endpoint returned full status including settings, last run metadata, validation state, and recent audit events — all healthy.

## Audit Trail (latest entries)

| Time | Actor | Action | Details |
|---|---|---|---|
| 17:05:57 | hermes | `hermes.import.completed` | Imported 6 signals, 0 updated |
| 17:05:57 | system | `provider_morning_digest.completed` | 1,707 candidates → 6 signals, 2 personas skipped |
| 17:00:55 | hermes | `hermes.import.completed` (validation) | Imported 0, updated 1 signal |

---

*Report written by Hermes Agent — cron job execution.*
