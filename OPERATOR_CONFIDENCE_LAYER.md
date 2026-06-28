# Phase 5A.1 — Operator Confidence Layer

**Audit Date:** 2026-06-27
**Subject:** Frontend-only confidence layer for the Operator workspace
**Files Changed:** `outputs/persona-command-center.html` only

---

## Before

The operator card showed:
- Persona name + handle
- `Opportunity:` (signal topic)
- `Why now:` (raw score dump like `Priority 75, freshness 68, velocity 42`)
- Quality pill, status pill, optional velocity pill
- Draft text area, Mark Sent / Send Later / Skip buttons

The suggestions panel showed:
- "Best post to send now: Persona Name: Topic"
- "Rising velocity idea: Persona Name: Topic"

The operator had to open the admin drawer to discover:
- Which provider produced the signal
- How many sources corroborated it
- What evidence URLs exist
- Why this signal was selected over others

Every recommendation was a black box.

---

## After

### Part 1 — Source Context

Every operator card now has a **ⓘ button** in the meta row. Clicking it expands an **inline panel** (no modal, no navigation) displaying:

| Field | Source |
|-------|--------|
| Provider badge | `signal.sourceProvider` or `signal.hermesProvider` |
| Source domain | `signal.source` |
| Evidence count + URL list | `signal.evidenceUrls` (up to 3 shown inline) |
| Publication time | `signal.firstSeenAt` |
| Persona name | `persona.name` |
| Search term | `signal.query` |
| Cluster size | `signal.sourceCount` |

The panel is hidden by default (`display: none`) and toggled via CSS class `.open`.

### Part 2 — Provider Badge

Each provider has a compact pill with an icon:

| Provider | Badge |
|----------|-------|
| RSS | 📰 RSS |
| News | 🌍 News |
| Crawl4AI | 🕷 Crawl4AI |
| Hermes | 🧠 Hermes |
| Mock | 🔬 Mock |
| X | 𝕏 X (future) |
| Reddit | 💬 Reddit |

The badge appears as the first element in the operator card's `operator-meta` row, before the confidence indicator and quality pill.

Implementation: `providerBadgeHtml(provider)` — a pure function that returns a `<span class="provider-badge">` with icon + escaped provider name.

### Part 3 — Chief of Staff Explanation

Replaced the raw `Why now: Priority X, freshness Y, velocity Z` with dynamic human-readable reasons derived from existing scores:

| Condition | Reason |
|-----------|--------|
| `noveltyScore >= 75` | High novelty |
| `velocityScore >= 70` | Rapid velocity |
| `relevanceScore >= 80` | Excellent persona fit |
| `sourceCount >= 3` | Multiple confirming sources |
| `freshnessScore >= 75` | Strong freshness |
| `priorityScore >= 80` | High confidence |
| `riskScore < 20` | Low risk |
| `priorityScore >= 60` (fallback) | Moderate priority |
| `priorityScore >= 40` (fallback) | Routine signal |
| else (fallback) | Low-priority observation |

Multiple reasons are joined with ` · ` (bullet separator). Examples:
- `Why selected: High novelty · Rapid velocity · Excellent persona fit.`
- `Why selected: Multiple confirming sources · Strong freshness · Low risk.`
- `Why selected: Moderate priority.`

No reasoning is invented — every condition is a direct comparison against existing score fields.

Implementation: `chiefExplanationHtml(signal)` — returns a `<span class="why-now">` containing the explanation.

### Part 4 — Evidence Preview

The Source Context inline panel (Part 1) includes evidence preview when the signal has `evidenceUrls`. Shows up to **3 items**, each displaying:
- Source domain (extracted from URL)
- Headline (signal topic)

Displayed as a compact list within the source context grid. No scrolling. No truncation beyond the link's `max-width: 200px`.

Implementation: `evidencePreviewHtml(signal)` — returns a `<div class="evidence-list">` with up to 3 `.evidence-item` elements.

### Part 5 — Velocity Confidence

Every operator card now displays a **confidence level** derived from three existing scores:

| Level | Criteria |
|-------|----------|
| **High** | `sourceCount >= 3` AND `priorityScore >= 75` AND `velocityScore >= 70` |
| **Medium** | (neither High nor Low) |
| **Low** | `sourceCount <= 1` AND `priorityScore < 50` |

Displayed as a `<span>` with class `confidence-high` (green), `confidence-medium` (amber), or `confidence-low` (muted). Renders alongside the provider badge before the quality pill: `**High** confidence`.

Implementation: `velocityConfidenceHtml(signal)` — returns a `<span>` with the confidence level.

### Part 6 — Operator Timeline

Each operator card now shows a **compact horizontal timeline** below the source context. Steps displayed:

```
● Hermes ▸ ● Imported ▸ ● Velocity ▸ ● Draft ▸ ● Approved ▸ ● Scheduled ▸ ● Published ▸ ● Performance
```

Each step is represented by a colored dot:
- **Green dot** (`.dot.done`): step has occurred
- **Blue dot** (`.dot.active`): step is currently active
- **Gray dot** (`.dot.pending`): step not yet reached

Timeline is derived from existing frontend data:
- `signal.generatedBy` / `signal.hermesRunType` → Hermes step
- Always `true` → Imported step
- `velocityAlerts.some(a => a.signalId === signal.id)` → Velocity step
- `drafts.some(d => d.sourceSignalIds.includes(signal.id))` → Draft/Approved steps
- `scheduleItems.some(p => p.status === "scheduled")` → Scheduled step
- `publishedPosts.length > 0` → Published step
- `publishedPosts.some(p => p.performance?.updatedAt)` → Performance step

Implementation: `operatorTimelineHtml(signal, personaId)` — returns a `<div class="timeline-compact">` with step dots and arrows.

### Part 7 — Suggestions

Suggestion text now includes provider and confidence metadata:

- `Best post to send now`: appends `(ProviderName · strong freshness, rapid velocity)` when the best signal has notable scores.
- `Rising velocity idea`: appends `(ProviderName · velocity X)`.

Example before: `"The Wonkette: Supreme Court ethics"`  
Example after: `"The Wonkette: Supreme Court ethics (rss · strong freshness, rapid velocity)"`

The operator immediately understands *why* this recommendation deserves attention without clicking anything.

### Part 8 — Visual Hierarchy

All new elements follow strict secondary/optional hierarchy:

| Element | Default state | Position |
|---------|--------------|----------|
| Provider badge | Always visible | First in meta row |
| Confidence | Always visible | Second in meta row |
| Chief explanation | Always visible | Below opportunity line |
| ⓘ toggle button | Always visible | Last in meta row |
| Source context panel | **Hidden** (`.source-context { display: none }`) | Below meta row |
| Operator timeline | Always visible | Below source context |

The primary workflow (Mark Sent, Send Later, +30m, Skip buttons) is unchanged. The confidence layer elements sit above the draft area in the first grid column, keeping the action buttons and text area in their original positions.

---

## Confidence Model Summary

```
signal.sourceProvider         ───→ Provider Badge
signal.evidenceUrls           ───→ Evidence Preview (inline, collapsible)
signal.sourceCount            ───→ Confidence: High/Medium/Low
signal.priorityScore          ───→ Confidence + Chief explanation
signal.velocityScore          ───→ Confidence + Chief explanation
signal.relevanceScore         ───→ Chief explanation (persona fit)
signal.noveltyScore           ───→ Chief explanation (novelty)
signal.freshnessScore         ───→ Chief explanation (freshness)
signal.riskScore              ───→ Chief explanation (risk)
signal.source                 ───→ Source domain in source context
signal.firstSeenAt            ───→ Publication time in source context
signal.query                  ───→ Search term in source context
signal.clusterId              ───→ (used for dedup grouping)
```

Everything shown is derived from existing backend scores. No new backend fields. No AI reasoning.

---

## Screens Changed

Only one file: `outputs/persona-command-center.html`

### CSS Added (~120 lines)
- `.provider-badge` — compact pill with icon + text
- `.source-context` / `.source-context.open` — collapsible inline panel
- `.source-context-grid` — definition list layout
- `.source-context-toggle` — ⓘ button style
- `.evidence-list` / `.evidence-item` / `.evidence-source` — evidence preview
- `.confidence-high` / `.confidence-medium` / `.confidence-low` — confidence colors
- `.timeline-compact` / `.timeline-step` / `.dot.*` / `.timeline-arrow` — timeline

### JavaScript Added (~130 lines)
- `providerBadgeHtml(provider)` — Part 2
- `evidenceCount(signal)` — Part 4 helper
- `chiefExplanationHtml(signal)` — Part 3
- `velocityConfidenceHtml(signal)` — Part 5
- `evidencePreviewHtml(signal)` — Part 4
- `operatorTimelineHtml(signal, personaId)` — Part 6
- `sourceContextHtml(signal, personaId)` — Part 1

### JavaScript Modified (~10 lines)
- `renderOperatorCards()` — added provider badge, confidence, ⓘ toggle, source context panel, timeline
- `renderSuggestionsPanel()` — added provider + score metadata to suggestion text

---

## Verification Results

| Command | Result |
|---------|--------|
| `npm run build` | ✅ PASS |
| `npm run typecheck` | ✅ PASS |
| `npm test` (frontend save path + smoke) | ✅ PASS (53/53) |
| `verify:phase5` | ✅ PASS (31/31) |
| `verify:velocity` | ✅ PASS (6/6) |
| `verify:first-run-persona-setup` | ✅ PASS (14/14) |

**Constraint verification:**

| Constraint | Status |
|------------|--------|
| Operator workflow unchanged | ✅ Buttons, actions, layout identical |
| Draft workflow unchanged | ✅ Draft generation, editing, rejection, approval all untouched |
| Scheduling unchanged | ✅ Schedule creation, cancellation, publication all untouched |
| Performance unchanged | ✅ Performance capture, A/B choices, ledger all untouched |
| Provider Registry untouched | ✅ No changes to `src/providers/` |
| Hermes untouched | ✅ No changes to `src/hermes/` |
| No new pages/tabs | ✅ All changes inline in existing operator cards |
| No AI reasoning invented | ✅ All explanations from existing score thresholds |
| Secondary/collapsed/optional | ✅ Source context hidden by default; confidence/chief reasons are subtle text |

---

## Remaining UX Opportunities

These are deferred — not needed for the confidence layer but worth noting for future phases:

1. **Keyboard shortcuts for confidence inspection** — a hotkey (e.g., `i`) to toggle the nearest source context panel without mouse interaction.
2. **Mini sparkline in source context** — show velocity trend over recent snapshots directly in the inline panel.
3. **Confidence filter in command strip** — add a quick filter to show only High/Medium confidence cards.
4. **Evidence URL favicons** — small domain favicons before each evidence link for faster visual scanning.

None of these block the confidence layer. The operator can now answer "Why am I seeing this?" for every recommendation without leaving the workspace.
