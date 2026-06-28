# Persona Save Regression Fix

## Root Cause

Two independent bugs in `outputs/persona-command-center.html` caused persona saves to fail with 400 errors and card titles to show seed/default names.

### Bug 1: `readPersonaDraft` sends empty niche when niche field absent

`readPersonaDraft()` (line 3682) reads `document.getElementById('niche-${personaId}')?.value || ''`. The simplified editor **has no** `niche-{personaId}` DOM element (the niche field was intentionally removed from the editor UI). `getElementById()` returns `null`, `?.value` is `undefined`, `|| ''` gives `''`. 

`savePersona()` sends `niche: ''` → backend `normalizePersonaPayload()` checks `payload.niche !== undefined` (true for `''`), then `!normalized.niche` (true for `''`) → throws `"niche is required"` (400 error). The entire PATCH fails, so the DB never updates.

### Bug 2 (consequence): Card titles show seed names

Because save fails, the backend DB retains seed names. `loadBackendData()` re-fetches `/api/personas` → response returns seed names → card header `<h3>${escapeHtml(persona.name)}</h3>` renders seed name.

Additionally, the editor card header always used `persona.name` (backend value) even while editing, so the header never reflected the in-progress edit.

## Files Changed

### `outputs/persona-command-center.html` (2 edits)

**Edit 1 — `readPersonaDraft` niche fallback** (line 3678-3689):

When `niche-{personaId}` DOM element does not exist (simplified editor), fall back to the persona's existing `persona.niche` from the in-memory `personas` array. The backend `COALESCE` in the UPDATE query already preserves existing DB values when niche is undefined — so sending the existing value is safe and idempotent.

```js
// Before
niche: document.getElementById(`niche-${personaId}`)?.value || "",

// After
const nicheInput = document.getElementById(`niche-${personaId}`);
// ...
niche: nicheInput ? nicheInput.value : (persona?.niche || ""),
```

Behavior: if the simple editor does not render a niche field, the saved niche value from the database is preserved. If a niche field is present in the DOM (e.g., in the full editor or any future UI), that value is used, allowing intentional niche edits.

**Edit 2 — Editor card header shows `draft.name` when editing** (line 2694-2695):

```js
// Before
<h3>${escapeHtml(persona.name)}</h3>
<div class="account">${escapeHtml(persona.account || persona.handle)}</div>

// After
<h3>${escapeHtml(editing && draft.name ? draft.name : persona.name)}</h3>
<div class="account">${escapeHtml(editing && draft.handle ? draft.handle : (persona.account || persona.handle))}</div>
```

While editing, the card header's name and account reflect the draft values so the user sees their edits immediately. After save/re-render, the backend response populates both.

### `scripts/verify-persona-save-regression.js` (new)

14-check regression test proving:
- `readPersonaDraft` falls back to `persona.niche` when niche DOM element absent (static)
- Editor card header uses `draft.name` when editing (static)
- Save succeeds without `niche` field in payload → no 400 (live API)
- Saved display name persists after reload (live API)
- Card title does not revert to seed/default label (live API)
- Niche preserved when omitted from payload (live API)
- voiceTone, platformStatus persisted (live API)
- Watch List entities intact after save (live API)
- Existing queries not lost after save (live API)
- Persona restored to original state (live API cleanup)

### `scripts/verify-frontend-save-path.js` (1 edit)

Updated check 10 to match the new `niche` read pattern (nicheInput ternary instead of raw `getElementById`).

### `package.json` (2 edits)

- Added `"verify:persona-save-regression"` script entry.
- Added `scripts/verify-persona-save-regression.js` to the `typecheck` chain.

## Verification Results

| Suite | Result |
|---|---|
| `npm run build` | PASS |
| `npm run typecheck` | PASS |
| `verify:frontend-save-path` | 64/64 PASS |
| `verify:persona-save-regression` | 14/14 PASS |
| `verify:persona-persistence` | 16/16 PASS |
| `verify:persona-intelligence-config` | 40/40 PASS |
| `verify:watchlist-ingestion` | 17/17 PASS |
| `verify:phase5` | 40/40 PASS |
| `tests/smoke-test.js` | PASS |

## Constraints Preserved

- No redesign of Persona UI.
- No schema changes.
- No Hermes / Watch List / Opportunity Engine changes.
- No X provider or PCC-side X API credential changes.
