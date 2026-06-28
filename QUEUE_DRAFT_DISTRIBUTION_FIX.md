# Queue Draft Distribution Fix

## Root Cause

The previous Operator Edit -> Queue fix removed the old global first-8 truncation, but it replaced it with unlimited rendering of every review-ready draft.

That made the Queue too noisy:

- Personas with many recent drafts, especially Chris Klebl and Sterling Digital, dominated the page.
- Peptide Tracker could still be pushed out visually even though eligible drafts existed.
- Queue had no persona-balanced selection rule.

## Files Changed

- `outputs/persona-command-center.html`
  - Added `selectQueueDrafts(drafts, { focusDraftId })`.
  - Draft Review now renders the selected Queue set instead of every eligible draft.
  - Default Queue selection is capped to 12 total drafts.
  - Default Queue selection is capped to 3 drafts per persona.
  - Focused draft exceptions remain visible and highlighted without enabling unlimited rendering.

- `scripts/verify-queue-draft-distribution.js`
  - Added targeted verification for Queue caps, persona distribution, hidden statuses, and focused draft exceptions.

- `package.json`
  - Added `verify:queue-draft-distribution`.
  - Added the new verifier to `typecheck`.

## Before / After Behavior

Before:

- Queue rendered every `needs_review`, `approved`, and `scheduled` draft.
- A persona with many drafts could dominate the entire Draft Review.
- There was no 12-total or 3-per-persona cap.

After:

- Default Queue renders at most 12 drafts total.
- Default Queue renders at most 3 drafts per persona.
- All four personas appear when they have eligible drafts.
- Drafts with `rejected`, `skipped`, or `published` status are hidden.
- Drafts are ordered within each persona by priority score, then newest timestamp.
- If Operator Edit opens Queue with a specific `focusDraftId`, that exact draft is included and highlighted even when it falls outside the normal 3-per-persona cap.
- A focused exception can make the Queue 13 items at most, not unlimited.

## Verification Results

Passed:

- `npm run verify:queue-draft-distribution`
- `npm run verify:operator-edit-queue-routing`
- `npm run verify:operator-actions`
- `npm run build`
- `npm run typecheck`
- `npm test`

Blocked in this sandbox:

- `npm run verify:production-drafts`
- `npm run verify:operator-production-clean`

Both blocked commands failed with `fetch failed` because this environment cannot connect to the local PCC server. This is the same local-network sandbox restriction seen in the previous Operator checks, not an application assertion failure.

## Recommendation

GO for the Queue Draft Review distribution fix.

Run the two live HTTP verifiers from a normal local terminal where `http://127.0.0.1:3000` is reachable:

```bash
npm run verify:production-drafts
npm run verify:operator-production-clean
```
