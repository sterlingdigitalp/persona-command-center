# RC-2 Validation & Hardening Report

**Date:** 2026-06-28  
**Status:** PASS with observations

---

## Verdict

**PASS** — All 12 PCC verify suites pass (100%), build/typecheck/test pass, production bridge dry-run completes cleanly. Two test-script issues were identified and fixed (false-positive pattern in operator-clean verifier, missing niche restoration check in persistence verifier). One Hermes-repo gap remains (`verify_writing_intelligence_v21.py` does not exist).

---

## Infrastructure

| Check | Result | Details |
|-------|--------|---------|
| Docker engine | ✅ PASS | 7.7GB memory, aarch64 |
| SearXNG (port 8080) | ✅ PASS | Ready, search returns results |
| Crawl4AI (port 11235) | ✅ PASS | Healthy |
| PCC health (port 3000) | ✅ PASS | Phase 4, uptime verified |
| Preflight script | ✅ PASS | Exit 0 |

---

## Hermes

| Check | Result | Details |
|-------|--------|---------|
| pytest (31 tests) | ✅ PASS | Installed via uv, all pass |
| `verify_draft_quality.py` | ✅ PASS | accepted:true, 3 drafts, no banned patterns, 7/7 editorial fields |
| `verify_writing_intelligence_v21.py` | ❌ MISSING | Script does not exist in `/Users/sterlingdigital/hermes-peptide-intelligence/scripts/` |

---

## PCC Verify Suites (12/12)

| Suite | Checks | Result | Notes |
|-------|--------|--------|-------|
| verify-cron-preflight | 9/9 | ✅ PASS | Bridge production command is direct, requires health/export preflight |
| verify-no-fallback-imports | 2/2 | ✅ PASS | Fallback payload rejected before import |
| verify-production-drafts | 5/5 | ✅ PASS | 31 ready posts, auto-draft from bridge |
| verify-operator-actions | 11/11 | ✅ PASS | Send/Later/Skip work without editedFinalText (RC-1 Fix 5) |
| verify-operator-edit-queue-routing | 19/19 | ✅ PASS | Routing with exact-draft focus helper |
| verify-queue-draft-distribution | 11/11 | ✅ PASS | Max 12, max 3/persona, focusDraftId exception |
| verify-editorial-intelligence-import | 5/5 | ✅ PASS | Hermes editorial metadata round-trip |
| verify-operator-production-clean | 3/3 | ✅ PASS | **Fixed**: removed over-broad `\btest\b` pattern, added explicit testMode check |
| verify-persona-interest-persistence | 6/6 | ✅ PASS | Interest CRUD survives reload |
| verify-persona-writing-export | 8/8 | ✅ PASS | Voice controls, writing guidance, fallback drafts export correctly |
| verify-persona-persistence | 15/15 | ✅ PASS | **Fixed**: added niche verification to restore check |
| verify-persona-save-regression | 15/15 | ✅ PASS | Niche preserved when omitted from PATCH payload |
| **Total** | **109/109** | **100%** | |

---

## Build & Type Checking

| Check | Result |
|-------|--------|
| `npm run build` | ✅ PASS |
| `npm run typecheck` | ✅ PASS (all source + script files) |
| `npm test` | ✅ PASS (frontend save + smoke test) |

---

## Production Bridge Dry-Run

| Metric | Value |
|--------|-------|
| Status | ✅ completed |
| Mode | production |
| Personas found | 4 |
| Entities processed | 41/41 (100%) |
| Imports accepted | 41 (0 rejected) |
| Drafts created | 123 |
| Ready posts | 32 |
| Exit code | 0 |

---

## Data Integrity (SQLite)

| Table | State | Details |
|-------|-------|---------|
| drafts | ✅ 758 needs_review, 1 published | Healthy pipeline |
| signals | ✅ 92 new, 70 archived, 2 dismissed, 1 used | Normal distribution |
| test_mode signals | ✅ 0 remaining | 2 dismissed during validation |
| scheduled_posts | ✅ 1 | Normal |
| notifications | ✅ 54 | Present |
| persona_queries | ✅ All 4 personas have active queries (3-4 each) | |
| persona state | ✅ the-wonkette restored to seed | Name: "The Wonkette", niche: seed value |

---

## Defects Fixed

1. **`verify-operator-production-clean.js` false positive** — `\btest\b` matched natural language ("stress test") in legitimate signals. Removed pattern, added explicit `testMode: true` field check. Aligned banned patterns with server's `OPERATOR_NOISE_PATTERNS`.

2. **`verify-persona-persistence.js` missing niche restoration check** — Restore check only verified name/handle/platformStatus, not niche. Added `restored.niche === original.niche` to the restore assertion.

---

## Remaining Observations

1. **Hermes missing script**: `scripts/verify_writing_intelligence_v21.py` does not exist in `/Users/sterlingdigital/hermes-peptide-intelligence/scripts/`. Only `verify_draft_quality.py` is present (which passes). This is a Hermes-repo gap to address separately.

2. **2 test_mode signals in DB**: `sig_74046611` and `sig_6d538343` had `test_mode=1` in the database. These are properly excluded by the server's `productionSignalSqlFilter()` and were dismissed during validation. No remaining test-mode data in operator view.

3. **Test isolation**: The persona-persistence and save-regression tests share `personas[0]` (the-wonkette). When run sequentially without proper restoration, the save-regression test's niche check failed because the persistence test left a modified niche. Fix applied: persistence test now verifies niche restoration.

---

## Final Verdict

**RC-2 is VALIDATED and READY for the git update.** All production paths are clean: no mock/demo/test data leaks into operator view, draft generation works end-to-end, editorial intelligence metadata round-trips correctly, queue distribution enforces limits, and the production bridge ingests 41/41 entities with 123 drafts. No feature changes were introduced — only verify-script fixes for false positives and hardening gaps.
