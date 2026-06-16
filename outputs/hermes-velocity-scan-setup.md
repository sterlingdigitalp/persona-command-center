# Hermes Velocity Scan Cron Setup - 2026-06-16

**Project:** Persona Command Center
**Provider:** lmstudio | **Model:** qwen3.6-35b-a3b-mtp | **Endpoint:** http://localhost:1234/v1

---

## New Velocity Scan Cron Job Created

### persona-command-center-velocity-scan

| Field       | Value                                                                                         |
|-------------|-----------------------------------------------------------------------------------------------|
| Job ID      | ada123d235a3                                                                                  |
| Schedule    | Daily at 4:00 PM America/New_York (cron: `0 16 * * *`)                                        |
| Workdir     | /Users/sterlingdigital/Documents/Codex/2026-06-15/you-are-working-from-the-existing           |
| Deliver     | local                                                                                         |
| State       | enabled, scheduled                                                                            |

**Command:** `node scripts/run-velocity-scan.js` with env vars:
- PCC_BASE_URL=http://localhost:3000
- HERMES_PROVIDER=lmstudio
- HERMES_MODEL=qwen3.6-35b-a3b-mtp
- HERMES_ENDPOINT=http://localhost:1234/v1
- HERMES_JOB_NAME=persona-command-center-velocity-scan

**Next run:** 2026-06-16T16:00:00-05:00 (today)

---

## How Velocity Scan Works

The velocity scan script (`scripts/run-velocity-scan.js`) POSTs to `/api/hermes/import` with `runType: "velocity_scan"`. This sets `hermesRunType=velocity_scan` on all generated signals via the existing `normalizeHermesSignal()` pipeline in `src/hermes/hermesClient.js`.

The import endpoint (`importHermesPayload`) records the run type in `ingestion_runs.run_type` and each signal's `hermes_run_type` column.

---

## Existing Jobs (Untouched)

| Name                                    | Job ID     | Schedule              | State                  |
|-----------------------------------------|------------|-----------------------|------------------------|
| persona-command-center-morning-validation | 187aed567186 | 40 5 * * * (05:40 ET) | enabled, scheduled     |
| persona-command-center-morning-digest   | 9de692df42c2 | 45 5 * * * (05:45 ET) | enabled, scheduled     |
| persona-command-center-midday-validation | 2274ddc8803b | 0 12 * * * (12:00 ET) | enabled, scheduled     |
| persona-command-center-midday-digest    | 2bcbaee9f9e1 | 5 12 * * * (12:05 ET) | enabled, scheduled     |

No modifications made to any existing cron jobs. All four remain in their original state with unchanged schedules and settings.

---

## Current Limitations

- **No dedicated velocity endpoint:** The velocity scan reuses the generic `/api/hermes/import` POST endpoint. There is no separate `/api/hermes/velocity-scan` route — it shares the same import pipeline as morning digest, midday brief, evening scan, and validation ping.
- **hermesRunType=velocity_scan applied via payload, not routing:** The run type is set by the `runType: "velocity_scan"` field in the POST body, which flows through `normalizeHermesSignal()` in `src/hermes/hermesClient.js`. This works correctly but means velocity scan signals are indistinguishable from other import payloads at the HTTP layer.
- **No run history yet:** The job has never executed (`last_run_at: null`). First run is scheduled for today at 16:00 ET.

---

## Summary

- [x] Velocity scan script created: `scripts/run-velocity-scan.js`
- [x] Cron job created: persona-command-center-velocity-scan (job_id ada123d235a3), daily at 16:00 ET
- [x] Uses same env var structure as midday digest jobs
- [x] Signals generated with `hermesRunType=velocity_scan` via `/api/hermes/import`
- [x] All existing cron jobs remain untouched (morning validation/digest, midday validation/digest)

---

## Definition of Done

- [x] Velocity scan cron job exists and is enabled at 16:00 daily
- [x] hermesRunType=velocity_scan successfully applied via POST payload to /api/hermes/import
- [x] All previous jobs (05:40, 05:45, 12:00, 12:05) confirmed unchanged and enabled
- [x] No existing jobs were modified during setup
- [ ] First execution at 2026-06-16T16:00 ET — pending (job has never run)
