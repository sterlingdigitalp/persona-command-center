# Watch List Add UX Fix

## Status: DELIVERED ✓

## Problem

The Watch List "+ Add" button opened a browser `prompt()` asking for an internal entity ID (`ent-karpathy`). Users had no way of knowing internal IDs, making the feature unusable without reading source code or seed data.

## Solution

Replaced the entity ID prompt with a small inline add form containing just two human-facing fields:

- **Name** (required) — e.g. "Andrej Karpathy"
- **X handle** (optional) — e.g. "@karpathy"

No entity IDs are ever displayed or requested from the user.

## Behavior

### Before
```
Click + Add → prompt("Entity ID (e.g. ent-karpathy)")
           → prompt("Priority (1-10):", "5")
           → POST /api/personas/:id/entities with entityId
```

### After
```
Click + Add → inline form appears with Name + X handle
           → user fills in name + optional handle
           → Click Save
           → 1. normalizeXHandle("karpathy") → "@karpathy"
           → 2. GET /api/entities → find by name or handle
           → 3. If not found: POST /api/entities to create it
           → 4. POST /api/personas/:id/entities to subscribe
           → 5. loadBackendData() refreshes the page
           → Watch List shows: Name | @handle | P5
```

## Key Details

### Handle normalization (`normalizeXHandle`)
- `karpathy` → `@karpathy`
- `@karpathy` → `@karpathy`
- Empty string → `''`

### Entity lookup order
1. Match by `name` (case-insensitive)
2. Match by `primary_x_handle` (case-insensitive)
3. If neither found, `POST /api/entities` creates a new entity with the given name and handle

### Subscription dedup
Before subscribing, the code fetches the current persona's full data and checks if a subscription for this entity already exists. If it does, no duplicate subscription is created.

### Validation
- If both Name and X handle are empty, an error message is shown: "Name or X handle is required."
- Errors appear inline in red text below the form
- Save button shows "Saving..." while processing and is disabled

## Files Changed

| File | Change |
|------|--------|
| `outputs/persona-command-center.html` | Added inline add form in `renderPersonaSectionWatchList`, replaced prompt-based `add-entity-btn` handler with form toggle + submit logic, added `normalizeXHandle` function, added CSS for inline form |
| `scripts/verify-frontend-save-path.js` | Added 10 new checks for Watch List add UX (61 total) |

## Verification Results

| Check | Result |
|-------|--------|
| `npm run build` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS (61/61 frontend checks + smoke test) |
| `verify:persona-intelligence-config` | PASS (36 checks) |
| `verify:persona-persistence` | PASS (15 checks) |
| `verify:phase5` | PASS (36 checks) |

### New Frontend Verification Checks

| Check | Status |
|-------|--------|
| Watch list add does not prompt for entity ID | PASS |
| Watch list add shows Name field | PASS |
| Watch list add shows X handle field | PASS |
| Watch list has Save button | PASS |
| Watch list has Cancel button | PASS |
| normalizeXHandle adds @ prefix | PASS |
| Entity is looked up by name or handle | PASS |
| Entity is created if not found | PASS |
| Subscription is created after entity exists | PASS |
| No entity ID prompt or required ID input | PASS |

## Backend Changes

**None.** The fix is entirely frontend-only, using existing APIs (`GET /api/entities`, `POST /api/entities`, `POST /api/personas/:id/entities`).

## User Flow

1. Click Watch List → **+ Add**
2. Inline form slides in below the list
3. Type name (e.g. "Sam Altman") and optionally X handle (e.g. "@sama")
4. Click **Save**
5. Form disappears, list refreshes showing the new entry with Name, X handle, and Priority
6. Click **Cancel** to dismiss the form without saving
