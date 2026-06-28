# RC-1 Hardening Report — Persona Command Center

## Data Flow (Validated)

```
06:30 Cron ──► Hermes Bridge (watch_list_processor.py)
                 │
                 ├── GET /api/hermes/export ◄── PCC SQLite (personas+entities)
                 │
                 ├── SearchAgent.search() ──► SearXNG (local)
                 ├── SearchAgent.research() ──► SearXNG + Jina Reader
                 ├── SearchAgent.fetch_platform() ──► AgentReach CLI tools
                 │                                       (twitter/opencli/bird)
                 │                              No api.twitter.com calls
                 │                              No X_BEARER_TOKEN needed
                 │
                 └── POST /api/hermes/import ◄── PCC
                        │
                        ├── Creates signals (dedup by clusterId/topic/text)
                        ├── Creates snapshots (each import)
                        ├── Generates velocity alerts (acceleration engine)
                        ├── Writes audit log
                        └── Operator queue updated (read-only aggregation)
                               │
                               ▼
                        Operator opens PCC
                        ├── Views Daily Briefing (highlights + suggested posts)
                        ├── Reviews operator cards (A/B draft variants)
                        ├── Approves/rejects/edits drafts
                        ├── Schedules posts
                        └── Marks published (manual, noExternalPublishing: true)
```

## Defects by Severity

### BLOCKER (Must fix before GO)

| # | File | Function | Issue | Reproduction |
|---|------|----------|-------|-------------|
| B1 | (entire system) | Notifications | **No notification system exists.** No `/api/notifications` endpoint, no notification table, no push mechanism, no UI (bell/badge/panel). Velocity alerts are in-app only. Operator must manually open PCC to see anything. | `grep -r "notification" src/` returns zero results. Check `outputs/persona-command-center.html` — no notification tab. |
| B2 | `src/hermes/hermesClient.js:6-10` | `getHermesAttributionDefaults` | Hardcoded fallback provider/model/endpoint (`lmstudio`/`qwen3.6-35b-a3b-mtp`/`http://localhost:1234/v1`) are used when env vars not set. Production deployment with wrong/missing env vars silently uses defaults instead of failing. | Start server without `HERMES_PROVIDER` — signals get attribution `provider: "lmstudio"`. |
| B3 | `~/.hermes/cron/jobs.json` | PCC production crons | **13 of 14 cron jobs paused.** Only "PCC Production Opportunity Engine" (06:30) is enabled. Morning validation (05:40), morning digest (05:45), midday validation (12:00), midday digest (12:05), velocity scan (16:00) all paused since 2026-06-20. | `cat ~/.hermes/cron/jobs.json` — 7 PCC jobs with `"paused": true`. |
| B4 | `~/.hermes/cron/output/6b44879e2a2b/2026-06-27_21-14-58.md` | `run_bridge` | Active 06:30 cron returns `[SILENT]` — no opportunities worth delivering. The pipeline finds nothing actionable. | Check most recent cron output. Empty result. |

### HIGH (Should fix before GO)

| # | File | Function | Issue | Reproduction |
|---|------|----------|-------|-------------|
| H1 | `outputs/persona-command-center.html:1721-1731` | `setupDrafts`, `fallbackScheduleItems` | Hardcoded fallback data rendered when backend returns empty. Operator sees fake content. | Start server, navigate to Operator before any signals — hardcoded "Test post about the future of AI" appears. |
| H2 | (operator queue) | `getOperatorQueue` | 30-50% of signals in operator queue are from verification test runs (`hermesProvider: "verification"`, `hermesModel: "smoke-test"`, sources like `mock-public-news.example`). These pollute the production operator view. | Run all verification scripts then check `GET /api/operator/queue` — signals with `mock-rss-feed.example` sources appear. |
| H3 | `src/server.js:1268-1284` | `bootstrapHermesMorningBriefing` | On every startup, attempts to run morning digest simulation. If `simulationModeEnabled` and no existing run, creates fake import. Operator sees stale simulation signals. | Restart server with fresh DB — signals from `buildHermesSimulationPayload` appear. |
| H4 | `src/ingestion/pipeline.js:67-70` | `collectPersonaCandidates` | When no entities/topics/sources configured, silently falls back to `persona.niche` with default provider. No warning or logging that production quality is degraded. | Create persona with no entities/topics/sources — `persona.niche` drives ingestion silently. |
| H5 | `config/defaultProviders.js:5-7` | defaultProviders | Default providers are `["rss", "news"]`. Crawl4AI is configured in `config/crawl4ai.js` but omitted from defaults. Production cron commands do not specify `HERMES_DIGEST_PROVIDERS`. | Crawl4AI is registered but never called in the default production path. |

### MEDIUM (Should fix within first week of production)

| # | File | Function | Issue |
|---|------|----------|-------|
| M1 | `src/providers/redditProvider.js:9` | `collectCandidates` | Stub: throws `NotImplemented`. Registered but non-functional. If ingestion pipeline ever resolves to reddit provider, 500 error. |
| M2 | `src/velocity/accelerationEngine.js:55-64` | `calculateFutureXAcceleration` | Stub/identity function. Normalizes input fields but does not compute acceleration. Present as future placeholder. |
| M3 | `src/providers/rssProvider.js:5-7` | (module scope) | Hardcoded BBC/NPR/NYT default RSS URLs. If these feeds change or are blocked, default RSS fails silently. |
| M4 | `src/hermes/hermesJobs.js:90` | `buildHermesSimulationPayload` | Hardcoded `hermes.local` evidence URLs used in simulation payloads. Non-resolvable in production. |
| M5 | `src/providers/xProvider.js:53-64` | `lookupUser`, `getUserTweets`, `getUserMentions` | Only supports exact handle lookup. No keyword search. The bridge uses SearchAgent (which can do keyword), but PCC-side xProvider.js cannot. |
| M6 | `outputs/persona-command-center.html:1455-1460` | Navigation tabs | Multiple sections (Operator/Queue/Personas/Sources) — operator needs 2-3 clicks to go from signals to drafts to schedule. No unified "today" view. |
| M7 | (entire system) | No system crontab | All scheduling depends on Hermes Desktop process running. If Hermes Desktop is down, no crons fire. No independent cron fallback. |

### LOW (Should document and fix when convenient)

| # | File | Function | Issue |
|---|------|----------|-------|
| L1 | `src/server.js:2497` | `createAppServer` | Hardcoded `http://127.0.0.1:3000` URL construction. |
| L2 | `config/crawl4ai.js:9` | crawl4ai config | Default endpoint `http://localhost:11235` hardcoded. |
| L3 | `src/hermes/hermesClient.js:7` | `getHermesAttributionDefaults` | Default endpoint `http://localhost:1234/v1` hardcoded. |
| L4 | `src/hermes/validationJob.js:13` | `runValidationAgainstBaseUrl` | Default endpoint `http://localhost:1234/v1` hardcoded. |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Operator misses opportunity because no notification | **High** | High — system becomes a manual-check tool | Implement notification system (blocker B1) |
| Cron pipeline delivers nothing (SILENT) | **High** | High — no content produced | Investigate bridge opportunity detection thresholds (blocker B4) |
| Verification signals confuse operator | **Medium** | Medium — operator sees test data mixed with real | Clean verification scripts to not leave production data (HIGH H2) |
| Wrong attribution defaults used in production | **Medium** | Medium — signals misattributed | Validate env vars at startup, fail if defaults would be used (blocker B2) |
| Paused crons not noticed by operator | **Medium** | High — no automated pipeline | Add cron health check to operator dashboard |
| redditProvider invoked in error path | **Low** | High — 500 error | Guard with try/catch or remove from registry |
| Hermes Desktop crashes → no cron | **Medium** | High — entire pipeline stops | Add system crontab fallback or supervisor |
| SearXNG/local dependencies unavailable | **Low** | Medium — bridge falls back to strategies 2/3 | Already handled in bridge error handling |

## Remaining Gaps vs Production Requirements

| Requirement | Status | Notes |
|-------------|--------|-------|
| Automated daily ingestion | ❌ | 13/14 crons paused |
| Notifications to operator | ❌ | Not implemented |
| Clean operator view (no test content) | ❌ | Verification signals pollute queue |
| Drafts generated automatically | ❌ | 0 drafts across all personas |
| Active cron delivers content | ❌ | Last run: `[SILENT]` |
| All providers configured | ❌ | redditProvider throws NotImplemented |
| Production env vars validated | ❌ | Silent fallback to hardcoded defaults |
| Independent cron (non-Hermes) | ❌ | No system crontab fallback |
| Crawl4AI in production path | ❌ | Omitted from default providers |
| What's new / delta indicator | ❌ | No "since last check" marker |

## Go / No-Go Recommendation

# NO GO

The system cannot be certified as a production daily-use application in its current state due to three blocking defects:

1. **No notification system (B1).** The operator has no reason to open PCC. Velocity alerts exist but are in-app only — no push, no email, no badge, no bell. The system relies entirely on the operator voluntarily checking the dashboard. This is not acceptable for a production daily-use tool.

2. **13/14 crons paused, active cron returns SILENT (B3/B4).** The automated pipeline is effectively non-operational. Even if the server is running, no content is being produced. The active 06:30 job found zero opportunities worth delivering.

3. **Operator view polluted with test data (H2/H3).** 30-50% of signals in the operator queue are from verification scripts with mock sources. The operator cannot distinguish production content from test data. Zero drafts exist, so the operator sees an empty "nothing to do" state.

### Path to GO

To reach GO, the following must be remediated:

| Priority | Required Fix |
|----------|-------------|
| P0 | Implement notification system (push, email, or at minimum in-app badge/bell) |
| P0 | Unpause production crons or establish why the pipeline produces nothing |
| P0 | Clean test/verification signals from production queue or separate test from prod data |
| P0 | Fix active cron to produce deliverables instead of SILENT |
| P1 | Validate all env vars at startup (fail if hardcoded defaults would be used) |
| P1 | Add cron health check to operator dashboard |
| P2 | Generate at least one draft per persona from top signals before operator opens PCC |
| P2 | Add "what's new since last check" indicator |
| P2 | Remove or guard redditProvider stub to prevent accidental 500 |

### Expected timeline

If notification system, cron remediation, and data cleanup are started immediately: **minimum 2 weeks** to reach a production-ready GO state.
