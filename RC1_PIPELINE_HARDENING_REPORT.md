# RC-1 Pipeline Hardening Report

## Scope

This pass hardened the Persona Command Center side of the Hermes Watch List Bridge. It did not redesign the frontend and did not change the ownership boundary: Hermes/SearchAgent owns retrieval; PCC owns configuration, import validation, storage, drafts, notifications, and Operator display.

## Root Causes

- The external bridge at `/Users/sterlingdigital/hermes-peptide-intelligence/search_agent/services/watch_list_processor.py` still builds fallback import payloads when SearchAgent retrieval fails.
- PCC accepted fallback payloads because Hermes import validation only checked shape, not retrieval quality.
- Operator filtering excluded `test_mode` rows but did not exclude mock/demo/fallback evidence patterns.
- Draft generation produced template-like text that included persona labels instead of publish-ready post options.
- The external bridge queue summary reads `/api/operator/queue` as a list, but PCC returns an object with a `personas` array.

## Files Changed

- `src/hermes/hermesClient.js`
- `src/server.js`
- `scripts/clean-test-signals.js`
- `scripts/verify-no-fallback-imports.js`
- `scripts/verify-operator-production-clean.js`
- `scripts/verify-production-drafts.js`
- `scripts/verify-cron-preflight.js`
- `package.json`
- `RC1_PIPELINE_HARDENING_REPORT.md`
- `NO_FALLBACK_IMPORTS_VALIDATION.md`
- `PRODUCTION_DRAFTS_VALIDATION.md`

## Before / After

Before:
- A failed SearchAgent/SearXNG run could import `Watch List entity ... — new opportunity detected`.
- Evidence like `SearchAgent unavailable` could appear in Operator.
- Operator could surface mock/demo/trial/validation debris.
- Production imports could show `draftCount: 0` or drafts that read like instructions.

After:
- PCC rejects failed-retrieval/fallback payloads before any signal row is created.
- Hermes X-search payloads must include usable HTTP evidence URLs.
- Default Operator queue filters mock/demo/test/trial/validation/fallback rows.
- Production imports request exactly 3 drafts per successful persona import.
- Draft bodies are publish-ready text and avoid legacy persona labels.
- Cleanup script archives active mock/demo/test/fallback signals from the local Operator view.

## Cleanup Result

`npm run clean:test-signals` archived 69 noisy active signals and rejected 0 linked drafts in the local SQLite database.

## Verification Results

- `npm run build`: PASS
- `npm run typecheck`: PASS
- `npm test`: PASS
- `npm run verify:no-fallback-imports`: PASS
- `npm run verify:cron-preflight`: FAIL, because the external bridge script still lacks bridge-level preflight checks and still contains the fallback topic path.
- `npm run verify:operator-production-clean`: blocked in this sandbox because no reachable dev server was available.
- `npm run verify:production-drafts`: blocked in this sandbox because no reachable dev server was available.

## External Bridge Work Still Required

The external file is outside this repo's writable root, so PCC was hardened defensively but the bridge itself still needs a patch:

- Add preflight checks for `/api/health`, `/api/hermes/export`, SearXNG, Crawl4AI if used, and SearchAgent import/callability.
- Return explicit entity statuses: `success`, `no_results`, `retrieval_failed`, `skipped`.
- Do not call `/api/hermes/import` unless status is `success` and evidence URLs are usable.
- Remove fallback topic generation: `Watch List entity ... — new opportunity detected`.
- Fix queue summary to count `queue.personas` and visible signal/draft items.

Expected command remains:

```bash
python3 /Users/sterlingdigital/hermes-peptide-intelligence/search_agent/services/watch_list_processor.py --production --pcc-base-url http://127.0.0.1:3000
```

## Remaining Risks

- PCC is now protected against fallback imports, but scheduled production bridge runs will fail instead of importing if the external bridge still sends fallback payloads.
- Full Operator and Ready Posts verification requires a clean reachable PCC dev server at `PCC_BASE_URL`.
- Cron hardening is not complete until the external bridge script is patched.

## GO / NO GO

NO GO for unattended RC-1 production until the external bridge script is patched and `npm run verify:cron-preflight`, `npm run verify:operator-production-clean`, and `npm run verify:production-drafts` pass against a running local PCC backend.
