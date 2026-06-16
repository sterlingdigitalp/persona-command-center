# Hermes Midday Digest Report

**Timestamp:** 2026-06-16T17:06:06Z  
**Run ID:** `run_cf54cb9a-9e33-4488-9ccc-25d6f1137b36`  
**Job Name:** persona-command-center-midday-digest  

---

## Digest Results

| Metric | Value |
|---|---|
| Exit Code | 0 (success) |
| Candidate Count | 1,702 |
| Signal Count | 12 |
| Attribution Completeness | complete |
| Provider | lmstudio |
| Model | qwen3.6-35b-a3b-mtp |
| Endpoint | http://localhost:1234/v1 |

## Per-Persona Signal Breakdown

| Persona | Signals |
|---|---|
| the-wonkette | 3 |
| policy-pete | 3 |
| maga-memester | 3 |
| progressive-pat | 3 |

**Total:** 12 signals across 4 personas (3 each).

## Backend Health Check

- **Endpoint:** `http://127.0.0.1:3000/api/hermes/health`
- **HTTP Status:** 200 OK
- **Response Time:** 0.157s
- **Status:** All digest jobs enabled (morning, velocity scan, midday brief, evening scan, simulation mode)

## Audit Summary

The backend recorded the following audit events for this run:
- `hermes.import.completed` — imported 6 signals, updated 6
- `hermes.provider_morning_digest.completed` — 12 signals from 1,702 candidates across rss + news providers
