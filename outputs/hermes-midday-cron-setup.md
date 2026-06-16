# Hermes Midday Cron Setup - 2026-06-16

**Project:** Persona Command Center
**Provider:** lmstudio | **Model:** qwen3.6-35b-a3b-mtp | **Endpoint:** http://localhost:1234/v1

---

## New Midday Cron Jobs Created

### 1. persona-command-center-midday-validation

| Field | Value |
|-------|-------|
| Job ID | 2274ddc8803b |
| Schedule | Daily at 12:00 PM America/New_York (cron: `0 12 * * *`) |
| Workdir | /Users/sterlingdigital/Documents/Codex/2026-06-15/you-are-working-from-the-existing |
| Deliver | local |
| State | enabled, scheduled |

**Command:** Same as morning validation — `node scripts/hermes-validation-job.js` with env vars:
- PCC_BASE_URL=http://localhost:3000
- HERMES_PROVIDER=lmstudio
- HERMES_MODEL=qwen3.6-35b-a3b-mtp
- HERMES_ENDPOINT=http://localhost:1234/v1
- HERMES_JOB_NAME=persona-command-center-midday-validation

**Next run:** 2026-06-16T12:00:00-05:00

---

### 2. persona-command-center-midday-digest

| Field | Value |
|-------|-------|
| Job ID | 2bcbaee9f9e1 |
| Schedule | Daily at 12:05 PM America/New_York (cron: `5 12 * * *`) |
| Workdir | /Users/sterlingdigital/Documents/Codex/2026-06-15/you-are-working-from-the-existing |
| Deliver | local |
| State | enabled, scheduled |

**Command:** Same as morning digest — `npm run hermes:morning-digest` with env vars:
- PCC_BASE_URL=http://localhost:3000
- HERMES_PROVIDER=lmstudio
- HERMES_MODEL=qwen3.6-35b-a3b-mtp
- HERMES_ENDPOINT=http://localhost:1234/v1
- HERMES_JOB_NAME=persona-command-center-midday-digest

**Next run:** 2026-06-16T12:05:00-05:00

---

## Existing Morning Jobs (Untouched)

| Name | Job ID | Schedule | State |
|------|--------|----------|-------|
| persona-command-center-morning-validation | 187aed567186 | 40 5 * * * (05:40 ET) | enabled, scheduled |
| persona-command-center-morning-digest | 9de692df42c2 | 45 5 * * * (05:45 ET) | enabled, scheduled |

No modifications made to existing morning jobs.

---

## Summary

- [x] Midday validation cron created: persona-command-center-midday-validation (job_id 2274ddc8803b), daily at 12:00 ET
- [x] Midday digest cron created: persona-command-center-midday-digest (job_id 2bcbaee9f9e1), daily at 12:05 ET
- [x] Both use same command structure and env vars as their morning counterparts
- [x] Morning jobs (05:40, 05:45) remain untouched
