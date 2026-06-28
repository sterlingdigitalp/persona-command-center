# Operator Edit Queue Routing Fix

## Root Cause

Operator Edit was carrying the right draft id in the daily briefing cards, but the Queue page did not reliably honor it:

- `quickEditDraft()` only focused an already-rendered textarea and otherwise navigated to Queue without preserving the selected draft id.
- Draft Review rendered only `drafts.slice(0, 8)`, so drafts for Peptide Tracker or Scott Decoded could be dropped whenever newer Sterling Digital or Chris Klebl drafts occupied the first eight rows.
- `/api/operator/queue` hid drafts when their linked source signal was not present in the first clean signal page. That made draft visibility depend on a rolling signal window rather than whether the linked signal was actually noisy.

## Files Changed

- `outputs/persona-command-center.html`
  - Added `queueFocusDraftId`.
  - Routed Operator Edit through `openQueueForDraft(draftId)`.
  - Made Draft Review render all review-ready drafts instead of truncating to eight.
  - Added stable `data-draft-id` markers and a subtle focused-draft state.

- `src/server.js`
  - Updated `/api/drafts` to return a broader recency-ordered review set.
  - Hardened `/api/operator/queue` so linked drafts are hidden only when their source signal is actually noisy/test data.

- `scripts/verify-operator-edit-queue-routing.js`
  - Added a verifier that seeds one temporary draft per persona, confirms all four personas are Queue-visible, confirms exact Edit targets resolve, and guards against the old first-eight truncation.

- `package.json`
  - Added `verify:operator-edit-queue-routing`.
  - Added the new verifier to `typecheck`.

## Before / After Behavior

Before:

- Clicking Edit could navigate to Queue without preserving the exact draft.
- Queue could show only the first eight draft rows.
- Peptide Tracker and Scott Decoded drafts existed in SQLite but could disappear from Draft Review.

After:

- Clicking Edit opens Queue and focuses the exact draft id.
- Queue Draft Review includes every `needs_review`, `approved`, or `scheduled` draft returned by `/api/drafts`.
- Draft visibility is no longer tied to whether linked source signals appear in the first signal page.
- Peptide Tracker, Sterling Digital, Scott Decoded, and Chris Klebl drafts are all visible when they exist.

## Verification Results

Passed:

- `npm run verify:operator-edit-queue-routing`
- `npm run build`
- `npm run typecheck`
- `npm test`
- `npm run verify:cron-preflight`

Blocked by local sandbox networking:

- `npm run verify:production-drafts`
- `npm run verify:operator-production-clean`

Both live API verifiers failed at connection setup with `fetch failed`. Port `127.0.0.1:3000` was already occupied by a node listener, but this sandbox could not connect to it and reported `connect EPERM 127.0.0.1:3000`. This is an environment/network permission issue, not an application assertion failure.

## Recommendation

GO for the Operator Edit -> Queue routing fix.

Run the two live API verifiers again from the normal local terminal where `http://127.0.0.1:3000` is reachable:

```bash
npm run verify:production-drafts
npm run verify:operator-production-clean
```
