# RC-1 Draft Persistence Fix

## Scope

This fix only touches production draft persistence verification and the `/api/hermes/import` draft response path.

It does not change:

- Hermes bridge
- cron preflight
- no-fallback import validation
- Operator cleanliness logic
- Persona UI
- Watch Lists

## Verification Payload

`scripts/verify-production-drafts.js` sends a non-test production Hermes payload:

- `runType: "morning_digest"`
- `provider: "SearchAgent"`
- `model: "search_agent_v1"`
- `endpoint: "search_agent://x_search/production-draft-check"`
- `jobName: "hermes-watch-list-bridge-morning_digest"`
- `personaId: "policy-pete"`
- `source: "hermes_x_search"`
- real HTTP evidence URL

The verifier now uses a unique topic and cluster id on every run:

- topic: `Paul Graham comments on AI use in schools <timestamp>`
- cluster id: `production-drafts-<timestamp>`

This avoids duplicate-update ambiguity and proves fresh draft creation.

## Root Cause

The recorded failing run:

`run_aee6cd2a-6eae-4fab-b7b9-45dafae01f8d`

was accepted and completed, but it updated an existing signal rather than creating a new one:

- `signals_created = 0`
- `signal_count = 1`
- signal id: `sig_dee6a0f9-3253-4177-838e-f141f3780c32`

The API response observed by verification had:

- `draftsGenerated: undefined`
- new drafts: `0`
- Ready Posts: `0`

In the current source, `/api/hermes/import` now initializes and returns:

```json
{
  "draftsGenerated": 0,
  "draftGenerationErrors": []
}
```

before draft generation, and then updates `draftsGenerated` after generating drafts.

If a live response still has `draftsGenerated: undefined`, the running backend process is stale and must be restarted from the current `src/server.js`.

## Fixes

1. `scripts/verify-production-drafts.js`
   - Uses a unique topic and cluster id every run.
   - Keeps production-style attribution so Operator does not hide the verifier row as test/verification data.

2. `src/server.js`
   - Import response always includes `draftsGenerated`.
   - Import response always includes `draftGenerationErrors`.
   - Draft generation failures are no longer silently swallowed; they are returned and audited.
   - Draft text length is clamped for the angle variant to avoid hidden X quality failures.

## Before / After Response Shape

Before:

```json
{
  "runId": "run_aee6cd2a-6eae-4fab-b7b9-45dafae01f8d",
  "runType": "morning_digest",
  "imported": 0,
  "updated": 1,
  "signalsReceived": 1,
  "importedSignalIds": ["sig_dee6a0f9-3253-4177-838e-f141f3780c32"]
}
```

After, before draft creation:

```json
{
  "draftsGenerated": 0,
  "draftGenerationErrors": []
}
```

After successful production draft creation:

```json
{
  "draftsGenerated": 3,
  "draftGenerationErrors": []
}
```

## Draft Rows Created

Expected after rerunning against the current backend:

- 3 `drafts` rows
- `status = "needs_review"`
- `persona_id = "policy-pete"`
- `source_signal_ids` contains the imported signal id
- bodies pass X quality checks

## Operator Ready Posts

Expected after rerunning against the current backend:

- `/api/operator/queue` includes the new drafts
- Ready Posts count is greater than 0

## Verification Results In This Session

Passed:

- `npm run build`
- `npm run typecheck`
- `npm test`
- `npm run verify:cron-preflight`
- `npm run verify:no-fallback-imports`

Blocked by local runtime connectivity in this sandbox:

- `npm run verify:operator-production-clean`
- `npm run verify:production-drafts`

Observed:

```text
curl http://127.0.0.1:3000/api/health
Failed to connect
```

`npm run dev` also could not start because port 3000 was occupied:

```text
EADDRINUSE: address already in use 127.0.0.1:3000
```

That means a stale/non-responsive listener owns the port in this environment.

## Required Final Rerun

Restart the PCC backend from the current source, then run:

```bash
npm run verify:production-drafts
npm run verify:operator-production-clean
npm run verify:no-fallback-imports
npm run verify:cron-preflight
npm run build
npm run typecheck
npm test
```

## GO / NO GO

NO GO from this sandbox because the live production-drafts verifier could not reach the backend.

Expected after restarting the backend and getting `verify:production-drafts` to pass:

GO WITH MINOR MONITORING.
