# RC-1 Production Certification — Persona Command Center

## Architecture

```
Personas (4)
  ├── Watch List (40 tracked entities, 41 subscriptions)
  ├── RSS Topics (13 total, 3-4 per persona)
  ├── Crawl Targets (3, progressive-pat only)
  └── Interests (12 total, 3 per persona)
       │
       ▼
  ┌─────────────────────────┐
  │  Hermes Export          │   GET /api/hermes/export
  │  contractVersion:       │   ~97 KB, <130ms
  │    "2026-06-phase4a"    │
  └─────────┬───────────────┘
            │
            ▼
  ┌─────────────────────────┐
  │  Hermes Watch List      │   watch_list_processor.py (442 lines)
  │  Bridge                 │   SearchAgent.search() → SearXNG
  │                         │   SearchAgent.research() → SearXNG + Jina
  │                         │   SearchAgent.fetch_platform() → AgentReach CLI
  │                         │   No PCC-side X API calls
  │                         │   No X_BEARER_TOKEN required
  └─────────┬───────────────┘
            │
            ▼
  ┌─────────────────────────┐
  │  Opportunity Detection  │   Signals → Velocity → Alerts
  │  ResearchPacket         │   Snapshot engine, acceleration engine
  │  OpportunityPacket      │   Alert levels: watch/rising/viral_window
  └─────────┬───────────────┘
            │
            ▼
  ┌─────────────────────────┐
  │  /api/hermes/import     │   3-strategy dedup: clusterId, topic,
  │                         │   text overlap >= 72%
  │                         │   Creates: signals, snapshots,
  │                         │   velocity alerts, audit log
  └─────────┬───────────────┘
            │
            ▼
  ┌─────────────────────────┐
  │  Operator Dashboard     │   SPA (4137 lines)
  │                         │   Daily Briefing
  │                         │   Hot Alerts
  │                         │   Operator Cards (A/B variants)
  │                         │   Queue, Schedule, Published
  └─────────┬───────────────┘
            │
            ▼
  Operator publishes manually (noExternalPublishing: true)
```

## Validation Results by Subsystem

| Part | Area | Result | Evidence |
|------|------|--------|----------|
| **1** | Configuration | **PARTIAL** | Watch List entities drive ingestion. `persona_queries` is backward-compat only. Fallback to `persona.niche` when no entities/topics/sources configured is a silent degradation risk. |
| **2** | Hermes Export | **PASS** | 4 personas, 40 entities, normalized handles, monitor flags, topics, crawl targets. 97 KB, 127ms. Contract version `2026-06-phase4a`. |
| **3** | Hermes Bridge | **PASS** | SearchAgent.search/research/fetch_platform only. No PCC-side X API calls. No X_BEARER_TOKEN. Comprehensive error handling (all 3 strategies fallback). No placeholder/mock/NotImplemented code. 19/19 bridge validation checks PASS. |
| **4** | Opportunity Pipeline | **PASS** | Watch List → Opportunity → ResearchPacket path is clean. No mock path in production. No dead code or unused legacy branches in production paths. Pipeline uses `trackedEntities` → `rssTopics` → `crawlTargets` → `niche` fallback. |
| **5** | Import | **PASS** | Creates signals + snapshots + velocity alerts + audit log entries. 3-strategy dedup (clusterId, topic, text overlap >= 72%). No duplicate rows. 40/40 phase5 checks PASS. |
| **6** | Operator Dashboard | **PARTIAL** | Correct persona/opportunity mapping. **Stale content**: 30-50% of signals in queue are from verification scripts (`hermesProvider: "verification"`, mock sources `mock-public-news.example`). Zero drafts/scheduled/published across all personas. Operator sees empty state. Hardcoded fallbacks in HTML (`fallbackScheduleItems`). |
| **7** | Notifications | **FAIL** | **No notification system exists.** No `/api/notifications` endpoint. No notification table. No notification UI (bell icon, panel, badge). Velocity alerts exist but are in-app only — the operator must actively open PCC to see them. No push, no email, no desktop notification. |
| **8** | Cron | **PARTIAL** | 06:30 ET cron enabled ("PCC Production Opportunity Engine", `6b44879e2a2b`). **13/14 cron jobs paused** (all PCC production crons). Last run returned `[SILENT]` — no opportunities delivered. No system crontab — entirely dependent on Hermes Desktop. Crawl4AI omitted from default providers. |
| **9** | Persistence | **PASS** | Data survives restart (22 signals, 12 ingestion runs, 0 drafts, 0 scheduled, 0 published preserved across restart). No duplicate imports on restart (`bootstrapHermesMorningBriefing()` checks for existing today's run). SQLite WAL mode. |
| **10** | Failure Injection | **PARTIAL** | xProvider returns empty array gracefully when token missing. Bridge handles all failure modes with fallback strategies. Pipeline uses `Promise.allSettled`. **Not tested:** SearXNG unavailable, Hermes unavailable, Hermes Desktop down, network partitions. |
| **11** | Performance | **PASS** | Export 127ms, Operator queue 56ms, Signals 4ms, Health 0.5ms, Velocity 6ms. Export payload 97KB. All endpoints sub-150ms with 22 signals. |
| **12** | Legacy Audit | **PARTIAL** | 17 `persona_queries` hits (backward-compat only, not ingestion). 2 NotImplemented hits (`redditProvider.js` stub). 0 TODO in production code. 0 deprecated. 0 pass placeholder. 9 hardcoded URLs (default RSS feeds, hermes.local, example.test). `calculateFutureXAcceleration()` is a stub/identity function. |
| **13** | User Workflow | **PARTIAL** | Complete morning workflow path exists. **Issues:** No notification to prompt operator to open PCC. Dashboard shows stale test signals. 0 drafts ready. No "what's new since last check" indicator. Multiple navigation sections (Operator/Queue/Personas/Sources) add cognitive load. |

## Key Metrics

| Metric | Value |
|--------|-------|
| Personas configured | 4 |
| Watch List entities | 40 tracked, 41 subscriptions |
| Default providers | rss, news (crawl4ai omitted) |
| Signals in queue | 22 (mix of real + test data) |
| Drafts ready | 0 |
| Scheduled posts | 0 |
| Velocity alerts | 0 |
| Ingestion runs | 12 (4 morning_digest + 8 trial_push) |
| Active crons | 1 of 14 |
| Export size | 97 KB |
| Average API response | <150ms |
| NotImplemented stubs | 1 (redditProvider) |
| Notification system | NOT IMPLEMENTED |
