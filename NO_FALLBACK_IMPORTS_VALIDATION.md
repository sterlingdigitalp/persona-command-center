# No Fallback Imports Validation

## Policy

PCC must not store fallback opportunities when retrieval fails.

Rejected examples:

- `Watch List entity Paul Graham (@paulg) — new opportunity detected`
- `hermes_x_search — SearchAgent unavailable (None)`
- `retrievalStatus: retrieval_failed`
- Hermes X-search imports with no usable HTTP evidence URLs

## Implementation

`src/hermes/hermesClient.js` now validates every Hermes signal before import. If the payload indicates failed retrieval or placeholder fallback language, validation throws and no ingestion run or signal row is created.

## Verification

Command:

```bash
npm run verify:no-fallback-imports
```

Result:

```text
PASS no fallback imports verification
PASS - fallback payload is rejected: rejected before import
PASS - no fallback signal rows created: 0 fallback rows
```

## Operator Cleanup

Command:

```bash
npm run clean:test-signals
```

Local result:

```text
archivedSignals: 69
rejectedDrafts: 0
```

## Remaining Bridge Requirement

The external bridge should still be patched so it does not send fallback payloads at all. PCC now rejects them, but the clean production behavior is for the bridge to record `retrieval_failed` in its summary and skip `/api/hermes/import` for that entity.
