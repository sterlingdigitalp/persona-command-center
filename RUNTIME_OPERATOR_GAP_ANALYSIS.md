# RUNTIME_OPERATOR_GAP_ANALYSIS.md

**Mission:** Runtime Workflow Certification  
**Role:** Builder C  
**Scope:** Only runtime operator experience. Ignore elegance, architecture, tests cleanliness.  
**Date:** 2026-06-27  
**Project:** Persona Command Center (local SQLite + single-file HTML served by Node)

Read source of truth: `Persona Command Center-Core Definition.md`

## Traced Live Workflow (Hermes → Performance)

Start: Hermes (external intelligence trigger)  
↓  
Signals (import + persistence)  
↓  
Velocity (snapshot deltas + alerts)  
↓  
Draft generation  
↓  
Review (signal + draft)  
↓  
Approval (with reasons gate)  
↓  
Scheduling (prep)  
↓  
Manual publish (mark-published)  
↓  
Performance tracking  

### Per-Transition Evaluation (runtime behavior observed via live server + curl + UI inspection + verification runs)

1. **Hermes → Signals**
   - Exists? Yes. `/api/hermes/import`, `/api/hermes/morning-digest/run`, simulate, validation.
   - Works? Yes. Live API calls import, create signal + snapshot + ingestion_run + audit. UI Sources buttons trigger (`runProviderDigest`, `simulateHermes`).
   - Intuitive? Partial. Sources section has buttons; after run, full data reload populates Operator view + explorer. No progress indicator beyond toast.
   - Persists? Yes. All in SQLite, survives restart. `GET /api/signals` and operator queue return them.
   - Matches Core? Yes for import/persistence/attribution. Hermes treated as external.

2. **Signals → Velocity**
   - Exists? Yes. `alertEngine`, `snapshotEngine`, `accelerationEngine` run inside hermesImport. `/api/velocity-alerts`, `/api/velocity/latest`, `/api/signals/:id/history`.
   - Works? Yes. Multiple snapshots → acceleration score + alertLevel (watch/rising/viral_window) + recommendedAction ("Draft post"). Verify-velocity and live double-import test produce alerts.
   - Intuitive? Partial. Alerts render in Operator view (pills + separate velocityAlerts list) and queue summary. Velocity scores visible on signal rows. No per-signal inline "velocity context" card in all lists. "Why now" in operator cards pulls from alerts when present.
   - Persists? Yes. `velocity_alerts` + `signal_snapshots` tables. History endpoint returns them.
   - Matches Core? Yes for monitoring acceleration and surfacing in dashboard.

3. **Velocity / Signals → Draft generation**
   - Exists? Yes. `POST /api/drafts/generate` (count 2-3), UI buttons in persona cards + quick operator path.
   - Works? Yes. Live: import signal → generate produces drafts with qualityChecks (X 280 char, links, hashtags, claims). Uses reviewed signals first, falls back to any. Operator cards synthesize draft variants from signals when no drafts exist.
   - Intuitive? Mixed. Persona card "Generate drafts" switches to Queue section. Main Operator cards auto-surface best draft text or signal text for immediate editing. No explicit "use this velocity alert to draft" button.
   - Persists? Yes. Draft rows + source_signal_ids + audit.
   - Matches Core? Yes (generate from signals).

4. **Draft generation → Review**
   - Exists? Yes. Draft review grid in Queue section. Signal review buttons ("Reviewed"/"Review") in persona cards + explorer. Signal mark-reviewed endpoint.
   - Works? Yes. Buttons call endpoints. Status updates to "reviewed" on signals, "needs_review" on drafts. UI textareas for edits + Save.
   - Intuitive? Weak. Review buttons exist but do nothing visible besides status pill change + full reload. No dedicated "Review queue" primary surface. Explorer requires filter/status sort to surface. Signal review and draft review are in different surfaces.
   - Persists? Yes. status + reviewed_at.
   - Matches Core? Partial (review surfaces exist).

5. **Review → Approval**
   - Exists? Yes. `/api/drafts/:id/approve`, `/api/drafts/:id/reject`. Buttons in draftReview grid. Quick paths auto-approve on Mark Sent/Send Later.
   - Works? Yes. Live verified. Enforces only from needs_review, re-computes qualityChecks, sets used on source signals, writes audit + review_reason/rejection_reason.
   - Intuitive? Weak. Approve/Reject buttons are plain, no reason input anywhere in UI (except hardcoded strings in quick operator paths). No confirmation or inline reason field. After approve, draft disappears from "needs" surface until reload.
   - Persists? Yes. status, reasons, audit.
   - Matches Core? No — Core explicitly requires "approve or reject drafts with reasons".

6. **Approval → Scheduling**
   - Exists? Yes. `POST /api/schedule` (requires approved draft), schedule list in Queue. "Send Later" and draft "Schedule" buttons.
   - Works? Yes. Live: approved draft → scheduled post created, draft status → scheduled, signals used. Idempotent mark-published gate.
   - Intuitive? Weak. "Send Later" always uses server default (+1h). No time picker, no scheduledAt control, no list of upcoming with edit. Schedule button only appears on approved drafts. Queue section mixes drafts + schedule list.
   - Persists? Yes. scheduled_posts table, status.
   - Matches Core? Partial (prep exists, but no prep controls).

7. **Scheduling → Manual publish**
   - Exists? Yes. `/api/schedule/:id/mark-published` (creates published_post, updates scheduled + draft). "Mark Sent" buttons in operator cards + schedule list rows.
   - Works? Yes. Live full trace: scheduled → published_manual + audit. Idempotent (repeat returns same). Operator choice outcome updated. Quick paths from draft/signal also reach publish.
   - Intuitive? Good for speed. "Mark Sent" in primary Operator cards is one-click after text tweak. Stale scheduled detection in suggestions. But no confirmation of external post URL at publish time in most paths (quick path sends empty url).
   - Persists? Yes. published_posts, status updates, source links, audit.
   - Matches Core? Yes (manual mark-as-published).

8. **Manual publish → Performance tracking**
   - Exists? Backend: `PATCH /api/published-posts/:id/performance` + ledger. Operator queue computes needsPerformance.
   - Works? Backend yes. Live curl trace captured impressions/likes etc, persisted, updatedAt set, audit written.
   - Intuitive? **No UI surface.** No form, no inputs, no button to enter metrics on any published post. "needsPerformance" drives only suggestion text. Trend highlights show aggregate perf numbers only after manual DB/API update. "Manual performance appears after mark sent" is the only hint.
   - Persists? Backend only.
   - Matches Core? No. Core explicitly requires "manually track publish + performance" and "manual performance capture".

## Operator Workflow Diagram (as-rendered in runtime UI)

```
Operator (primary "brief" section)
├── Command strip (counts: opportunities / ready / need edit / scheduled / published / momentum)
├── Operator cards (per persona) 
│   ├── Opportunity + Why now (velocity or signal or scheduled)
│   ├── A/B/neither radios + variant preview
│   ├── Quick textarea (editable final text)
│   └── [Mark Sent] [Send Later] [Skip]   ← fast path: records choice + approve/schedule/publish
├── Trend highlights (velocity spark, perf aggregate, recurring)
└── Suggestions panel (best now, needs attention, stale, rising)

Embedded in same view:
- Top signals / persona cards (generate drafts, review/dismiss per signal)
- Signal explorer (filters, Review/History buttons)
- Velocity alerts list

Queue section (nav "Queue"):
- Schedule list (times, Mark Sent, Skip/cancel)
- Draft Review grid (textarea + Save / Approve / Reject / Regenerate / Schedule)

Personas + Sources sections for config + Hermes triggers.

Arrows in practice:
Hermes buttons (Sources) → reload → Operator cards populate from signals/velocity/drafts
Signal review (cards/explorer) → status change
Generate drafts (cards) → switch to Queue + draft cards
Quick Mark Sent (Operator) → full chain + choice record + reload
```

Multiple overlapping surfaces for same entities.

## Documented Issues

**Missing workflow stages (runtime UI):**
- No input for signal review_reason (mark-reviewed always sends `{}`).
- No input for draft approval/rejection reason (approve/reject send `{}` except quick paths).
- No performance capture UI (impressions/likes etc) despite published_posts table, needsPerformance flag, and Core requirement.
- No scheduledAt / time control for scheduling (always default server time).
- No dedicated performance ledger view or edit surface.

**Duplicated workflow:**
- Action surfaces: persona cards (brief), operator cards (brief), draftReview grid (Queue), schedule rows (Queue), explorer rows, suggestions.
- Publish paths: direct from signal, from draft (auto-approve), from scheduled, raw published-posts POST.
- Data fetches: operator/queue vs separate /signals /drafts /schedule /published-posts (UI reconciles locally with fallbacks).
- Fallback static scheduleItems when backend empty.

**Broken operator flow:**
- Performance tracking completely unreachable from UI (compute exists, input does not).
- Review/approval reasons required by Core Definition and stored/audited, but operator cannot provide them at runtime.
- "needsPerformance" in queue summary and needsAttention picker has zero corresponding button or flow.
- Velocity "recommendedAction" ("Draft post") is display only; no link or prefill into draft gen.

**Unnecessary clicks:**
- Generate drafts auto-switches to Queue, but then user must locate the new draft cards to approve/schedule.
- To use staged path: click Generate → nav to Queue (or already switched) → edit/approve → click Schedule → later click Mark Sent in list.
- Quick Operator path avoids some but still full-reloads entire dashboard after every action.
- History per signal requires separate click + panel render.
- Section navigation required for full staged review even though primary view is "Operator".

**Runtime failures (observed):**
- None in core API transitions (verified via live server trace + phase5 verification).
- Provider-backed digest can produce 0 signals in environments without live RSS (UI shows toasts, no hard crash).
- Quick publish from signal bypasses draft entirely (intentional shortcut, not failure).
- Empty body on quick "neither" + publish is allowed (server accepts).

**Confusing state transitions:**
- Signal status "reviewed" vs draft "needs_review" (overlapping terminology).
- Approve draft → signals go to "used" (hidden from open queue).
- Quick Mark Sent can publish from any of signal/draft/scheduled in one click, making staged statuses sometimes skipped.
- Schedule list shows only scheduled (published moved out); no unified "my posts" timeline.
- Status pills and command strip numbers update only after full backend reload.
- Archived/used signals drop from most views but remain queryable.

## Operator Loop Completeness Score (0–100)

**Score: 58**

Breakdown (runtime operator lens only):
- Backend transitions (Hermes import → signals → snapshots/velocity → drafts → approve/reject → schedule → mark-published → performance + operator choices + audit): 92/100 (all paths exist, enforced, persist, verified live).
- UI surfaces for stages: 55/100 (Operator cards cover fast path well; review/approve/schedule accessible but scattered).
- Reason capture (Core requirement): 0/100.
- Performance capture (Core requirement): 0/100.
- Scheduling controls (time/prep): 20/100.
- Velocity context in decision surface: 65/100.
- Low-friction end-to-end (single view fast path): 75/100.
- Full staged explicit loop match: 30/100.

## Top Workflow Blockers (runtime)

1. **Performance tracking has no UI** — final required stage of the loop is invisible and impossible for operator.
2. **Review + approval reasons have no input** — Core Definition explicitly calls for reasons + audit trail; UI only hardcodes a few in quick path.
3. **Scheduling is time-less** — "Send Later" and schedule always default; no operator control over when.
4. **Staged review flow is fragmented** — requires section switches and multiple reloads between generate → review/approve → schedule → publish.
5. **Velocity recommended actions are passive** — "Draft post" never wires into a draft action.

## Top Workflow Improvements (runtime, no arch)

1. Add simple inline reason text inputs (or quick-pick + free text) on every Reviewed, Approve, Reject, Dismiss action.
2. Add performance entry row or modal for any published post that lacks metrics (use the existing needsPerformance flag to surface actionable cards).
3. Add minimal scheduled time control (quick +1h / +4h / tomorrow or ISO input) on Send Later and schedule buttons.
4. Make primary Operator cards the canonical surface: surface pending review/approve items directly inside cards instead of forcing Queue nav.
5. Inline "use this" actions from velocity alerts and signal rows directly to draft gen or quick text prefill.
6. Show published posts with performance gaps inside Operator/Queue with one-click "Enter metrics" (simple 6-number form that PATCHes).

## Version 1 Readiness Assessment

**Backend operator loop:** Version 1 ready. All transitions per Core Definition exist, work reliably, persist in SQLite, produce audit, enforce gates (approved-only schedule, scheduled-only publish, quality checks, cross-persona rejection, idempotent publish, non-negative perf). Phase 5 verification + live curl traces + smoke test all pass.

**Runtime operator experience (what the user actually clicks):** Not Version 1 ready.

Critical missing:
- Ability to supply review/approval reasons (explicit Core requirement).
- Ability to capture performance (explicit Core requirement + "manual performance capture").
- Scheduling preparation is bare (no time control).
- Performance stage is completely absent from UI despite data model and queue logic.

The fast "Operator" cards provide a usable shortcut loop for publish, but the full explicit "review → draft → approve with reason → schedule → publish → performance" promised in Core and Phase 5 docs cannot be completed by an operator using only the dashboard.

**Verdict:** The system can be driven end-to-end via API or scripts. The rendered operator experience does not yet deliver a complete, intuitive, reason-capturing, performance-capturing local command center.

Fixes required before V1 claim: the three missing UI capture surfaces (reasons, schedule time, performance) + wiring the needs* flags to actual operator actions.

No other notes. Pure runtime evaluation only.
