# Persona Voice + Interest Controls

## Root Cause

Seeded interests used fixed IDs in `db/seed.sql` with `ON CONFLICT(id) DO NOTHING`.

When a user deleted a seeded interest, the row disappeared from `persona_interests`. On a later database init/restart, the seed insert saw that fixed ID as missing and recreated it. There was no deletion tombstone to distinguish "missing because never seeded" from "missing because the user deleted it."

## Files Changed

- `db/schema.sql`
  - Added `personas.voice_controls`.
  - Added `persona_interest_deletions`.

- `src/db.js`
  - Added idempotent migrations for voice controls and interest deletion tombstones.
  - After seed runs, deleted seed interests are removed again if tombstoned.

- `src/server.js`
  - Added `voiceControls` normalization/defaults.
  - Added interest deletion tombstones.
  - Added writing-ready Hermes export shape.
  - Added persona voice/interests into fallback draft generation.
  - Added persona voice config into draft metadata.

- `outputs/persona-command-center.html`
  - Added compact Persona Voice Tuning controls.
  - Saved `voiceControls` alongside existing persona fields.

- `scripts/verify-persona-interest-persistence.js`
  - New verifier for seeded interest deletion persistence and Hermes export absence.

- `scripts/verify-persona-writing-export.js`
  - New verifier for voice controls, writing guidance, interest deletion export, and draft metadata.

- `package.json`
  - Added:
    - `verify:persona-interest-persistence`
    - `verify:persona-writing-export`

## New Persona Fields

Stored as `personas.voice_controls` JSON:

```json
{
  "humorLevel": "low|medium|high",
  "contrarianLevel": "low|medium|high",
  "explainerLevel": "low|medium|high",
  "punchinessLevel": "low|medium|high",
  "memeLevel": "low|medium|high",
  "technicalDepth": "low|medium|high",
  "emotionalIntensity": "low|medium|high",
  "riskTolerance": "low|medium|high",
  "formalityLevel": "low|medium|high"
}
```

Existing `voiceTone` remains the free-text voice summary.

## Hermes Export Shape

Each persona now includes:

```json
{
  "name": "Scott Decoded",
  "handle": "@...",
  "niche": "...",
  "voiceTone": "...",
  "interests": [],
  "voiceControls": {},
  "watchList": [],
  "writingGuidance": {
    "personaName": "Scott Decoded",
    "voiceTone": "...",
    "interests": ["Media & Culture", "Tech & Free Speech"],
    "watchList": ["..."],
    "voiceControls": {
      "humor": "high",
      "contrarian": "medium",
      "explainer": "low",
      "punchiness": "high",
      "memeNative": "high",
      "technicalDepth": "low",
      "emotionalIntensity": "medium",
      "riskTolerance": "medium",
      "formality": "low"
    },
    "writingDo": [],
    "writingDont": []
  }
}
```

## Draft Quality Guard

Fallback draft generation now uses:

- persona `voiceControls`
- persona interests
- persona voice tone

Draft metadata includes:

```json
{
  "personaVoiceConfig": {
    "voiceTone": "...",
    "voiceControls": {},
    "interests": []
  }
}
```

This gives Hermes/PCC an audit trail for which voice configuration shaped the draft.

## Verification Results

Passed:

- `npm run verify:persona-interest-persistence`
- `npm run verify:persona-writing-export`
- `npm run verify:operator-actions`
- `npm run build`
- `npm run typecheck`
- `npm test`

Blocked in this sandbox:

- `npm run verify:persona-persistence`
- `npm run verify:persona-save-regression`

Both older verifiers failed at `fetch failed` because this environment cannot connect to a local PCC server. Their static checks passed where applicable. This is the same local networking limitation seen in prior tasks, not a code assertion failure.

## Recommendation

GO.

Persona interest deletion is now durable across init/restart, voice controls persist and export, and fallback draft generation no longer collapses all personas into one generic voice.
