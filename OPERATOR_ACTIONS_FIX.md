# Operator Actions Fix

## Root Cause

Operator Send/Later/Skip wrote an `operator_draft_choices` record before completing the local workflow. The Operator front page now renders suggested posts in compact cards, and those cards do not always have the older `quick-{personaId}` textarea present.

That meant the frontend often sent:

```json
{
  "outcome": "recorded",
  "editedFinalText": ""
}
```

The backend treated `editedFinalText` as required for every non-skipped choice, so Send failed early with:

```text
400 editedFinalText is required
```

The related Edit -> Queue visibility issue had two causes:

- Draft Review rendered only the first 8 drafts.
- Operator queue could hide drafts when their linked source signal did not appear in the first page of clean signals.

## Files Changed

- `outputs/persona-command-center.html`
  - Operator action text now falls back to the existing draft/scheduled/recommended body when no textarea edit exists.
  - Send/Later/+30m use the shared fallback text.
  - Skip routes through the shared Operator skip handler so it writes the same action record.
  - Edit opens Queue with the exact draft id and focuses it.
  - Queue renders all review-ready drafts instead of the first 8 only.

- `src/server.js`
  - Operator draft-choice creation now uses `editedFinalText` when supplied, otherwise falls back to the selected draft text.
  - Outcome updates no longer overwrite a valid final text with an empty string.
  - Scheduled/published/skipped outcomes no longer require a separate edited text when draft text already exists.
  - Operator queue draft filtering no longer depends on source signals appearing in the first clean signal page.
  - Exported core workflow functions so verification can exercise the real persistence path against an isolated DB.

- `scripts/verify-operator-actions.js`
  - Added targeted verification for Send/Later/Skip across all four personas.

- `scripts/verify-operator-edit-queue-routing.js`
  - Existing verifier continues to prove Queue visibility and exact draft resolution.

- `package.json`
  - Added `verify:operator-actions`.
  - Added `verify-operator-actions.js` to typecheck.

## Endpoint / Payload Before vs After

Before:

```json
POST /api/operator/draft-choices
{
  "personaId": "policy-pete",
  "draftA": "Existing draft text...",
  "selectedVariant": "A",
  "editedFinalText": "",
  "outcome": "recorded"
}
```

Result:

```json
{
  "error": "editedFinalText is required"
}
```

After:

```json
POST /api/operator/draft-choices
{
  "personaId": "policy-pete",
  "draftA": "Existing draft text...",
  "selectedVariant": "A",
  "outcome": "recorded"
}
```

Result:

```json
{
  "outcome": "recorded",
  "editedFinalText": "Existing draft text..."
}
```

Outcome updates also work without re-sending edited text:

```json
PATCH /api/operator/draft-choices/:id/outcome
{
  "outcome": "published",
  "scheduledPostId": "post_...",
  "publishedPostId": "pub_..."
}
```

## Proof

`npm run verify:operator-actions` proved:

- Send succeeds for all four personas without `editedFinalText`.
- Later succeeds for all four personas without `editedFinalText`.
- Skip succeeds for all four personas without `editedFinalText`.
- Published rows are `published_manual`.
- No external X post id is recorded.
- Sent count increases after Send for all four personas.
- Queue contains drafts for all four personas.
- Queue can resolve every Later/Edit target.

`npm run verify:operator-edit-queue-routing` proved:

- Operator Edit routes through `openQueueForDraft(draftId)`.
- Draft Review has stable `data-draft-id` targets.
- Draft Review no longer truncates to the first 8 drafts.
- Peptide Tracker and Scott Decoded no longer disappear from Queue data.

## Verification Results

Passed:

- `npm run verify:operator-actions`
- `npm run verify:operator-edit-queue-routing`
- `npm run verify:no-fallback-imports`
- `npm run build`
- `npm run typecheck`
- `npm test`

Blocked in this sandbox:

- `npm run verify:production-drafts`
- `npm run verify:operator-production-clean`

Both blocked commands failed with `fetch failed` because this environment cannot connect to the local PCC server. This is the same local-network sandbox restriction observed previously, not an application assertion failure.

## Recommendation

GO for the Operator Send/Edit action-path fix.

Run these two live HTTP verifiers from a normal local terminal where `http://127.0.0.1:3000` is reachable:

```bash
npm run verify:production-drafts
npm run verify:operator-production-clean
```
