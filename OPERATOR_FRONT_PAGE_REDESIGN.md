# OPERATOR_FRONT_PAGE_REDESIGN.md

## Before
- Operator page was a complex dashboard with command-strip KPIs (6 tiles including momentum), operator-cards with A/B, full meta, source context, timeline, quick-post, actions.
- Side suggestions panel.
- insight-grid with Signal velocity trend, Account performance trend, Recurring clusters.
- Additional today'sWork panels for needs, drafts, perf, completed.
- Heavy UI with lots of pills, badges, explanations, dense cards.
- Desktop and mobile not optimized for quick daily scan-and-send.
- Language mixed with implementation terms (signals, velocity).

Operator felt like admin panel, not front page for "what to post today".

## After
- Replaced main content of #brief (Operator) with clean Daily Briefing.
- Simple todayStats: 4 tiles (Opportunities, Ready posts, Sent, Needs edit).
- Hot Alerts placeholder (renderHotAlerts()).
- .daily-briefing two-col (desktop) / stack (mobile <800px).
- Per persona: Highlights (3 compact) + Suggested Posts (3).
- Highlights: one-line title + why + confidence + freshness.
- Suggested: post text + char count + Send / Edit / Later / Skip buttons.
- Language: Opportunity, Highlight, Suggested Post, Send, Later, Skip, Why?.
- Removed from front: detailed operator-cards complexity, trends, recurring, perf pending noise, A/B selectors, long meta.
- Advanced/reference in collapsed details.
- Mobile-first: single column, thumb buttons, no horiz scroll.
- Uses existing data (queuePersonaItems, signals, alerts, drafts, published) mapped to new view.
- Graceful empty states.

Top of page answers: What is hot? What should I post?

## Daily workflow
Open → scan 4 personas' highlights (why now) → scan 12 suggested posts → Send obvious (calls markOperatorSent) → Edit if needed (quick edit) → Later/Skip → done.

No need to leave front page for normal use. Queue for details.

## Mobile behavior
@media (max-width:800px) { .daily-briefing { grid-template-columns:1fr; } }
Compact cards, full width textareas avoided, buttons usable.

Desktop: side-by-side columns for fast scan.

## Removed UI elements (from front page)
- Signal velocity trend card
- Account performance trend
- Recurring clusters
- Old operator-layout/cards heavy grid (A/B, full meta, source ctx, timeline)
- insight-grid trends
- old command tiles with momentum etc.
- dense status on front
- suggestions side panel (moved logic into per-persona)
- Performance pending / needs as separate heavy (integrated lightly into hot if urgent)

Kept in advanced or other sections.

## Data mapping
- Highlights: velocityAlerts per persona (viral/rising) or top signals (topic, why, conf, freshness).
- Suggested: drafts (text, status) or recommendedTextFor + quick actions.
- Stats: from queue items signals/drafts/scheduled/publishedToday.
- Hot: high vel alerts.
- Actions delegate to existing: markOperatorSent, sendOperatorLater, skipOperatorItem, approve/reject draft wrappers.

No new backend. Minor UI button helpers added (quick*).

## Remaining work
- Full Intelligence Packet integration for richer highlights (future).
- Real notification feed to hotAlerts.
- Polish copy per persona.
- Test with real Crawl4AI mixed providers.
- A/B choice still available in edit flow.

## Verification
- build/typecheck/test/verify-phase5/verify-persona-* passed (see run logs).
- Frontend verify updated and passes checks for new elements, language, no old trends on front, mobile, hot alerts, actions.
- Mobile layout CSS present.
- renderHotAlerts + dailyBriefing present.
- 4 persona sections render.
- Suggested actions exist (Send/Edit/Later/Skip).
- No horiz overflow.
- Runtime: front page focuses on scan-and-act for posting.

This makes Operator the true front page: calm, mobile-first, opportunity-focused.
