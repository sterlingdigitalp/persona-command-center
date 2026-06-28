# RC-1 Final Bridge Hardening

## Status

The production-hardened bridge replacement has been created and syntax-checked at:

`external_bridge/watch_list_processor.py`

The sandbox could not install it directly to:

`/Users/sterlingdigital/hermes-peptide-intelligence/search_agent/services/watch_list_processor.py`

Install failed with:

`EPERM: operation not permitted, copyfile ... -> /Users/sterlingdigital/hermes-peptide-intelligence/search_agent/services/watch_list_processor.py`

Run this from a normal terminal to install:

```bash
cd /Users/sterlingdigital/Documents/Codex/2026-06-15/you-are-working-from-the-existing
npm run install:rc1-bridge
```

## Files Changed

- `external_bridge/watch_list_processor.py`
- `scripts/install-rc1-bridge.js`
- `package.json`
- `RC1_FINAL_BRIDGE_HARDENING.md`
- `PRODUCTION_BRIDGE_CERTIFICATION.md`

## Preflight Implementation

The hardened bridge performs preflight before processing entities:

- PCC reachable via `GET /api/health`
- PCC export available via `GET /api/hermes/export`
- SearchAgent importable/callable via `SearchAgent.health()`
- SearXNG available via `SearXNGProvider().health()`
- Optional Crawl4AI health via `--require-crawl4ai`

If required preflight fails, the bridge stops before processing entities and sends no imports.

## Retrieval Status Implementation

Every entity ends in exactly one status:

- `success`
- `no_results`
- `retrieval_failed`
- `skipped`

Only `success` may continue to import.

## Fallback Removal

The hardened bridge has no placeholder import path. It does not generate:

- `Watch List entity ... — new opportunity detected`
- `SearchAgent unavailable (None)`

Failed retrievals are recorded only in bridge summary and never sent to PCC import.

## ResearchPacket Pipeline

The bridge now runs:

`SearchAgent.search()` -> `SearchAgent.research()` -> `ResearchPacket`

Search results are used as evidence candidates, not as Operator headlines.

## OpportunityPacket Generation

Successful evidence-backed retrievals are converted into `OpportunityPacket` objects with:

- what happened
- why now
- evidence
- confidence
- conversation summary
- suggested operator action

Raw URLs are preserved as evidence.

## Draft Generation

The bridge calls `DraftGenerationService().generate_drafts_for_packet(packet)` and includes three draft options in `rawData.drafts`.

PCC also independently creates three Operator-ready drafts after successful non-test imports.

## Queue Verification

The hardened bridge treats `/api/operator/queue` as the object PCC actually returns and counts:

- visible signals
- visible drafts
- visible operator items
- ready posts

## Bridge Summary

The summary reports:

- entities queued
- entities processed
- success
- no_results
- retrieval_failed
- skipped
- imports accepted
- imports rejected
- drafts created
- visible operator items
- ready posts

## Verification

Completed in this sandbox:

- `python3 -m py_compile external_bridge/watch_list_processor.py`: PASS
- `npm run typecheck`: PASS
- `npm run verify:no-fallback-imports`: PASS

Blocked in this sandbox:

- `npm run install:rc1-bridge`: blocked by EPERM when writing to the external Hermes project path.
- Production bridge run: requires installing the bridge replacement and a reachable local PCC/SearXNG runtime.

## Final Production Run Command

After installing the bridge:

```bash
~/bin/pcc-morning-preflight.sh
python3 /Users/sterlingdigital/hermes-peptide-intelligence/search_agent/services/watch_list_processor.py \
  --production \
  --pcc-base-url http://127.0.0.1:3000
```

Then run:

```bash
npm run verify:cron-preflight
npm run verify:no-fallback-imports
npm run verify:operator-production-clean
npm run verify:production-drafts
```
