# Production Drafts Validation

## Policy

Successful production Hermes imports should create Operator-ready drafts.

For each successful persona import, PCC now requests exactly 3 draft options:

- factual/safe
- opinionated
- explanatory

Drafts are stored in the existing `drafts` table and are visible through `/api/operator/queue` when tied to production-clean signals.

## Implementation

`src/server.js` now:

- Calls `generateDrafts({ count: 3 })` after non-test Hermes imports.
- Uses saved persona records only for lookup; draft text does not include legacy persona labels.
- Generates publish-ready draft bodies instead of “frame/write this” template instructions.
- Creates one notification per persona import with `draftCount` equal to created drafts.
- Filters Operator drafts that are linked only to hidden/noisy signals.

## Validation Command

```bash
npm run verify:production-drafts
```

This command requires a reachable PCC backend at `PCC_BASE_URL`, defaulting to:

```text
http://127.0.0.1:3000
```

## Current Result In This Sandbox

The script could not complete here because the sandbox could not reach a clean local dev server:

```text
FAIL production drafts verification
FAIL - production draft verification ran: fetch failed
```

`npm test` passed, and direct no-fallback import validation passed.

## Manual Verification

With PCC running:

```bash
npm run dev
npm run verify:production-drafts
npm run verify:operator-production-clean
```

Expected:

- production import accepted
- `draftsGenerated: 3`
- `drafts` table count increases
- Operator `Ready Posts > 0`
- no legacy labels: `The Wonkette`, `PolicyPete`, `MAGA Memester`, `ProgressivePat`
