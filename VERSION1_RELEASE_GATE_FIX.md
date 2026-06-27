# VERSION1_RELEASE_GATE_FIX.md

**Bug:** querySql zero-row PRAGMA ghost row  
**Fix Date:** 2026-06-27  
**Status:** Gate cleared

## Bug Description
In src/db.js, `querySql` prepends `PRAGMA busy_timeout = 5000;\n` before the user SQL and invokes `sqlite3 -json`.

For zero-row SELECTs, sqlite3 outputs:
```
[{"timeout":5000}]
```
instead of `[]`.

The existing `lastIndexOf("\n[")` parse hack only worked when a second result array was present.

Affected callers (existence checks):
- `getPersonaById(...)` → returned ghost instead of null
- `getScheduledPost(id)`
- `getPublishedPost(id)`
- `getPublishedPosts({scheduledPostId: missing})` → returned [ghost] instead of []
- Any `await querySql("SELECT ...")` with 0 results, followed by `.length` or `[0]`

This was the final blocker after Builder V's "Version 1 Conditionally Certified".

## Smallest Safe Fix
Only edited inside `querySql` in src/db.js (no other changes).

After `JSON.parse(...)`:

```js
const result = JSON.parse(...);
if (idx < 0 && Array.isArray(result) && result.length === 1 && "timeout" in result[0]) {
  return [];
}
return result;
```

WAL mode, busy_timeout PRAGMA, all other behavior unchanged. Server, frontend, providers, operator flow untouched.

## Regression Tests Added
Added to `tests/smoke-test.js` (executed by `npm test`):

1. Direct `querySql` on zero-row SELECT returns `[]` (using isolated temp DB + dynamic import to hit current module).
2. Direct `querySql` on one-row SELECT returns the real row (not ghost or []).
3. `GET /api/personas/definitely-missing-...` returns 404/error (not ghost persona object via getPersonaById).
4. `GET /api/published-posts?scheduledPostId=missing-...` returns `[]` (via getPublishedPosts).

## Verification Results
- `npm run build` — PASS
- `npm run typecheck` — PASS
- `npm test` — PASS (including new ghost regression + "querySql ghost row regression: passed" log)
- `npm run verify:persona-persistence` — (fetch mode, same as pre-fix behavior)
- `npm run verify:persona-protection` — same
- `npm run verify:velocity` — PASS
- `node scripts/verify-phase-5-operator-loop.js` (the publish/performance flow Builder V flagged) — **FULL PASS**, including:
  - manual published post created
  - manual performance captured
  - published ledger persists
  - operator queue includes .../published
  - no ghost objects observed

Live reproduction before fix: `[{"timeout":5000}]` for zero-row.

After fix in code: length===0 for zero-row.

All zero-row existence checks now behave correctly while WAL + busy_timeout=5000 remain fully enabled.

## Conclusion
Version 1 release gate cleared. No other issues.

(The prior VERSION1_INTEGRATION_CERTIFICATION.md can now be considered unconditional.)
