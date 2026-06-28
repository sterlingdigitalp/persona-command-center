# Production Bridge Certification

## Certification State

NO GO until the staged bridge replacement is installed into the external Hermes project and production verification passes.

The replacement bridge is ready at:

`external_bridge/watch_list_processor.py`

Install command:

```bash
npm run install:rc1-bridge
```

The Codex sandbox could not perform that copy because the target is outside the writable workspace.

## Certification Criteria

### 1. Bridge aborts cleanly when infrastructure is unavailable

Implemented in the staged bridge through preflight checks for PCC, PCC export, SearchAgent, SearXNG, and optional Crawl4AI.

### 2. No placeholder opportunities are imported

Implemented. The staged bridge never builds fallback opportunity topics or unavailable evidence. PCC also rejects fallback payloads defensively.

Validated:

```text
PASS no fallback imports verification
PASS - fallback payload is rejected: rejected before import
PASS - no fallback signal rows created: 0 fallback rows
```

### 3. Only evidence-backed retrievals reach PCC

Implemented. The bridge only imports when retrieval status is `success` and usable HTTP evidence URLs exist.

### 4. Search results become ResearchPackets

Implemented. The bridge calls `SearchAgent.search()` and then `SearchAgent.research()` to produce a `ResearchPacket`.

### 5. ResearchPackets become OpportunityPackets

Implemented. The bridge converts each successful `ResearchPacket` into an `OpportunityPacket` with editorial title, evidence, confidence, summary, and operator action.

### 6. OpportunityPackets generate three drafts

Implemented. The bridge calls `DraftGenerationService` for three draft options and includes those drafts in the import raw data. PCC creates three persisted drafts after successful production import.

### 7. Ready Posts > 0

Pending live verification after install and production run.

### 8. Operator shows only production opportunities

PCC-side filtering and cleanup are implemented. Pending live verification after install and production run.

### 9. Bridge summary matches PCC state

Implemented in the staged bridge by counting `queue.personas`, visible signals, visible drafts, visible items, and ready posts.

## Verification Performed

```text
python3 -m py_compile external_bridge/watch_list_processor.py
PASS

npm run typecheck
PASS

npm run verify:no-fallback-imports
PASS
```

## Verification Still Required After Install

```bash
~/bin/pcc-morning-preflight.sh
python3 /Users/sterlingdigital/hermes-peptide-intelligence/search_agent/services/watch_list_processor.py \
  --production \
  --pcc-base-url http://127.0.0.1:3000
npm run verify:cron-preflight
npm run verify:no-fallback-imports
npm run verify:operator-production-clean
npm run verify:production-drafts
```

## Recommendation

NO GO until the staged bridge replacement is installed and live production verification passes.

Expected state after install and passing verification:

GO WITH MINOR MONITORING.
