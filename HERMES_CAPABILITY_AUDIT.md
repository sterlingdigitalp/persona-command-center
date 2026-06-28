# Hermes Capability & Production Operations Audit

**Date:** 2026-06-27  
**Project:** Persona Command Center (Phase 5A complete)  
**Audit Type:** Intelligence-platform audit of Hermes Agent itself  
**Provider:** lmstudio | **Model:** qwen3.6-35b-a3b-mtp | **Endpoint:** http://localhost:1234/v1

---

## PART 1 — Cron Operations Inventory

### Summary

All 13 cron jobs are currently **paused/disabled**. Zero active scheduled jobs.

| # | Job Name | Mission | Enabled | Schedule | Timezone | Last Run | Next Run | Status | Deliver |
|---|----------|---------|---------|----------|----------|----------|----------|--------|---------|
| 1 | persona-command-center-cron-proof | One-shot proof of cron pipeline execution | ❌ Disabled (completed) | once at 2026-06-15 22:47 | America/New_York | 2026-06-15 22:43 | N/A | paused/completed | local |
| 2 | persona-command-center-morning-validation | Daily validation ping (export state → import → verify) | ❌ Disabled | 40 5 * * * | America/New_York | 2026-06-19 05:41 | N/A | paused | local |
| 3 | persona-command-center-morning-digest | Daily morning digest (generate signals per persona → import) | ❌ Disabled | 45 5 * * * | America/New_York | 2026-06-19 05:46 | N/A | paused | local |
| 4 | persona-command-center-provider-digest-proof | One-shot provider-backed digest proof (every 5m, repeat=once) | ❌ Disabled | every 5m (one-shot) | America/New_York | Never ran | N/A | paused | local |
| 5 | persona-command-center-midday-validation | Daily midday validation ping | ❌ Disabled | 0 12 * * * | America/New_York | 2026-06-19 12:01 | N/A | paused | local |
| 6 | persona-command-center-midday-digest | Daily midday digest (generate signals per persona → import) | ❌ Disabled | 5 12 * * * | America/New_York | 2026-06-19 12:06 | N/A | paused | local |
| 7 | persona-command-center-velocity-scan | Daily velocity scan (detect signal acceleration) | ❌ Disabled | 0 16 * * * | America/New_York | 2026-06-19 16:01 | N/A | paused | local |
| 8 | Agent 2 — Edge Researcher (MVP-Focused) | Polymarket swarm: identify MVP-relevant edge cases | ❌ Disabled | every 60m | America/New_York | 2026-06-22 01:45 | N/A | paused | origin (delivery error) |
| 9 | Agent 5 — Contradiction Hunter (HYP-006 Attack) | Polymarket swarm: contradiction detection & devil's advocate | ❌ Disabled | every 60m | America/New_York | 2026-06-22 01:02 | N/A | paused | origin (delivery error) |
| 10 | Agent 6 — Cross-Market Comparative (MVP-Focused) | Polymarket swarm: cross-market comparison analysis | ❌ Disabled | every 60m | America/New_York | 2026-06-22 00:53 | N/A | paused | origin (delivery error) |
| 11 | Agent 7 — MVP Validation Agent (Renamed) | Polymarket swarm: MVP validation | ❌ Disabled | every 60m | America/New_York | 2026-06-20 02:56 | N/A | paused | origin (delivery error) |
| 12 | Agent B — Synchronization & Settlement Truth Researcher | Polymarket swarm: sync/settlement research | ❌ Disabled | every 60m | America/New_York | 2026-06-22 00:27 | N/A | paused | origin (delivery error) |
| 13 | Agent A — Market Microstructure Researcher | Polymarket swarm: market microstructure analysis | ❌ Disabled | every 60m | America/New_York | 2026-06-22 01:12 | N/A | paused | origin (delivery error) |

### Key Findings

- **All PCC crons paused** since 2026-06-20 at ~03:58 ET. No active scheduled jobs remain.
- **Polymarket swarm agents paused** since 2026-06-22 at ~01:17 ET due to delivery failures (`no delivery target resolved for deliver=origin`).
- **Success rate on PCC crons:** 100% (all completed successfully before being paused).
- **Success rate on swarm agents:** Mixed — Agent B ran OK, Agents A/5/6/7 returned errors.
- **No cron is currently delivering intelligence** to any destination.

---

## PART 2 — SearchAgent Audit

### Is SearchAgent Currently Active?

**Status: Installed but NOT integrated into Persona Command Center pipeline.**

SearchAgent exists as a fully implemented Python package at `/Users/sterlingdigital/hermes-peptide-intelligence/search_agent/` with the following surfaces:

| Surface | Public API | Status |
|---------|-----------|--------|
| Web search | `search(query)` via SearXNG JSON endpoint | ✅ Implemented & live-verified |
| Source Registry | Stable `SRC-xxxxx` IDs (SQLite-backed) | ✅ Implemented |
| Single fetch | `fetch(url)` with Jina Reader + direct fallback | ✅ Implemented |
| Multi-fetch | `fetch_many(urls)` with dedupe, cache reuse, metrics | ✅ Implemented |
| Agent Reach platform fetch | `fetch_platform(url)` for YouTube/Reddit/GitHub/X | ✅ Implemented |
| Thin research packet | `research(query)` → search + fetch_many → ResearchPacket | ✅ Implemented |

### Where Is SearchAgent Used?

- **Peptide Intelligence Swarm:** SearchAgent is used as the web-search backbone for the peptide knowledge base (12 peptides, evidence tiers A-G). It provides general web search via SearXNG and platform-specific fetch via Agent Reach.
- **NOT integrated into Persona Command Center:** The PCC pipeline (`rssProvider.js` → `newsProvider.js` → `crawl4aiProvider.js` → Chief of Staff → Import → Velocity → Operator) does not invoke SearchAgent at any stage.

### When Is It Invoked? How Often?

- **Morning Digest: NOT participating.** The digest cron prompt instructs Hermes to generate signals from RSS/News/Crawl4AI only. No `search()` or `fetch_many()` calls are part of the digest workflow.
- **Midday Digest: NOT participating.** Same as morning — provider-only pipeline.
- **Velocity Scan: NOT participating.** Velocity reads signals already imported; it does not trigger SearchAgent queries.

### Why Is SearchAgent Not Participating?

1. **Architectural boundary:** PCC providers are JavaScript modules (`rssProvider.js`, `newsProvider.js`, etc.) that implement a `collectCandidates(persona, queryConfig)` interface. SearchAgent is a Python package with a completely different API surface.
2. **No bridge layer exists:** There is no Hermes-side orchestration that calls SearchAgent's `search()` or `research()` and converts results into PCC signals.
3. **Cron prompts don't reference it:** The digest/validation cron jobs are self-contained agent prompts that instruct the agent to run npm commands — they never invoke SearchAgent as a capability.

### Should SearchAgent Become Part of Daily Intelligence Collection?

**YES.** Here's why:

| Capability | Current PCC Coverage | Gap | SearchAgent Can Fill |
|-----------|---------------------|-----|---------------------|
| Broad web search | RSS (curated feeds only) | Limited to pre-configured feed URLs | `search()` queries any topic across the open web via SearXNG |
| Source diversity | 3 providers (RSS, News, Crawl4AI) | No platform-specific sources | Agent Reach fetches YouTube, Reddit, GitHub, X content |
| Evidence aggregation | None — signals are raw provider output | No cross-source correlation | `research()` generates ResearchPackets with evidence + contradictions |
| Source verification | None | No independent verification of claims | `fetch_many()` can independently verify URLs from any provider |
| Contradiction detection | None | No mechanism to flag conflicting reports | ResearchPacket includes `contradictions` field |

### Evaluation Matrix

| Feature | Available? | Used in PCC? | Recommendation |
|---------|-----------|-------------|---------------|
| `search()` | ✅ Live-verified (SearXNG) | ❌ No | **Enable** — integrate as a 4th provider |
| `fetch_many()` | ✅ Implemented, tested | ❌ No | **Enable** — use for source verification |
| ResearchPacket generation | ✅ Implemented | ❌ No | **Enable** — enrich digest outputs with structured analysis |
| Evidence aggregation | ✅ Built into research() | ❌ No | **Enable** — cross-reference signals across providers |
| Contradiction detection | ✅ Shallow (Phase 4) | ❌ No | **Enable** — flag conflicting claims before import |
| Source diversity | ✅ YouTube/Reddit/GitHub/X via Agent Reach | ❌ No | **Enable** — expand beyond RSS/News/Crawl4AI |

### SEARCHAGENT_UTILIZATION.md

See the separate deliverable below.

---

## PART 3 — Capability Inventory

### Built-in Hermes Capabilities (Current Profile)

| # | Capability | Installed | Configured | Enabled | Status | Recommendation |
|---|-----------|----------|-----------|---------|--------|---------------|
| 1 | **SearchAgent** (`search_agent` package) | ✅ Yes — full Python package, 49 files, 28 tests passing | ✅ SearXNG at localhost:8080, Jina Reader, SQLite cache/registry | ❌ NOT used in PCC pipeline | Implemented but under-utilized | **Enable** — integrate as intelligence enrichment layer |
| 2 | **web_search** (built-in tool) | ✅ Yes | ✅ Configured (backend: empty string → defaults to web provider) | ✅ Active | Operational | **Keep** |
| 3 | **web_extract** (built-in tool) | ✅ Yes | ✅ Configured | ✅ Active | Operational | **Keep** |
| 4 | **Browser tools** (navigate, click, type, snapshot, vision) | ✅ Yes | ✅ Configured | ✅ Active | Operational | **Keep** |
| 5 | **terminal** (built-in tool) | ✅ Yes | ✅ Local backend | ✅ Active | Operational | **Keep** |
| 6 | **execute_code** (Python with Hermes tools) | ✅ Yes | ✅ Configured | ✅ Active | Operational | **Keep** |
| 7 | **cronjob** (scheduled jobs) | ✅ Yes | ✅ Configured, 13 jobs exist | ❌ All paused | Operational but idle | **Enable** — resume PCC crons when backend is running |
| 8 | **memory** (persistent facts) | ✅ Yes | ✅ Active, ~40% used (2,976/7,500 chars) | ✅ Active | Operational | **Keep** |
| 9 | **session_search** (conversation history search) | ✅ Yes | ✅ SQLite-backed | ✅ Active | Operational | **Keep** |
| 10 | **delegate_task** (subagent orchestration) | ✅ Yes | ✅ Configured, max_spawn_depth=1 | ✅ Active | Operational | **Keep** |
| 11 | **image_generate** (text-to-image via FAL.ai/FLUX 2) | ✅ Yes | ✅ FAL.ai backend configured | ✅ Active | Operational | **Keep** |
| 12 | **text_to_speech** (voice generation) | ✅ Yes | ✅ Configured | ✅ Active | Operational | **Keep** |
| 13 | **vision_analyze** (image inspection) | ✅ Yes | ✅ Native vision enabled | ✅ Active | Operational | **Keep** |
| 14 | **RSS provider** (`rssProvider.js`) | ✅ Yes — PCC module | ✅ 3 default feeds (BBC, NPR, NYT Politics) | ✅ Registered in registry | Operational | **Keep** |
| 15 | **News provider** (`newsProvider.js`) | ✅ Yes — PCC module | ✅ Google News RSS feed builder | ✅ Registered in registry | Operational | **Keep** |
| 16 | **Crawl4AI provider** (`crawl4aiProvider.js`) | ✅ Yes — PCC module (stub) | ⚠️ Registered but NotImplemented | ❌ Not producing signals | Stub/NotImplemented | **Enable or remove** — currently a placeholder |
| 17 | **X/Twitter provider** (`xProvider.js`) | ✅ Yes — PCC module (stub) | ⚠️ Registered but NotImplemented | ❌ Not producing signals | Stub/NotImplemented | **Phase 5B candidate** |
| 18 | **Reddit provider** (`redditProvider.js`) | ✅ Yes — PCC module (stub) | ⚠️ Registered but NotImplemented | ❌ Not producing signals | Stub/NotImplemented | **Future consideration** |
| 19 | **Mock provider** (`mockProvider.js`) | ✅ Yes — PCC module | ✅ Registered in registry | ⚠️ Available as fallback | Operational (fallback only) | **Disable for production** — never use in live intelligence |
| 20 | **Chief of Staff** (`chiefOfStaff.js`) | ✅ Yes — PCC module | ✅ Receives signals from all providers | ✅ Active when backend runs | Operational | **Keep** |
| 21 | **Velocity engine** (alert/acceleration/snapshot) | ✅ Yes — 3 sub-engines | ✅ Reads provider-backed signals | ✅ Active when backend runs | Operational | **Keep** |
| 22 | **Hermes import pipeline** (`hermesImport.js`) | ✅ Yes | ✅ Normalizes + stores signals | ✅ Active when backend runs | Operational | **Keep** |
| 23 | **Model routing** (config.yaml) | ✅ Yes | ✅ Default: qwen3.6-35b-a3b-mtp via lmstudio | ✅ Active | Operational | **Keep** |
| 24 | **Provider routing** (fallback_providers) | ⚠️ Configured but empty array `[]` | ❌ No fallback configured | N/A | Under-configured | **Add fallback provider** if primary fails |
| 25 | **Agent orchestration** (`delegate_task`) | ✅ Yes | ✅ max_concurrent_sessions=16, max_spawn_depth=1 | ✅ Active | Operational | **Keep** |
| 26 | **Planning** (`plan` skill) | ✅ Skill installed | ✅ Writes to `.hermes/plans/` | ⚠️ Available but rarely used | Under-utilized | **Enable for complex tasks** |
| 27 | **Summarization** (LLM-native capability) | ✅ Yes — inherent in all models | N/A | ✅ Active | Operational | **Keep** |
| 28 | **Classification** (LLM-native capability) | ✅ Yes — inherent in all models | N/A | ✅ Active | Operational | **Keep** |
| 29 | **Vector search / Embeddings** | ❌ NOT installed | ❌ No vector DB, no embedding pipeline | ❌ Not available | Missing | **Future consideration** — not needed for Phase 5A |
| 30 | **Local models (LM Studio)** | ✅ Yes | ✅ http://localhost:1234/v1 | ✅ Active as primary provider | Operational | **Keep** |

### Capability Summary

- **Installed:** 30 capabilities identified across built-in tools, PCC modules, and skills
- **Actively used in production pipeline:** ~15 (RSS, News, web_search, browser, cron, memory, etc.)
- **Under-utilized:** SearchAgent, Planning skill, delegate_task subagents
- **Stub/NotImplemented:** Crawl4AI provider, X provider, Reddit provider
- **Missing (not needed for Phase 5A):** Vector search, Embeddings pipeline

---

## PART 4 — Skill Discovery

### Complete Skills Inventory (42 skills across 16 categories)

| Category | Skills | Used in PCC? | Recommendation |
|----------|--------|-------------|---------------|
| **autonomous-ai-agents** | hermes-agent, ai-coding-agents, kanban-codex-lane | Partially (hermes-agent loaded for this audit) | **Keep** — hermes-agent is essential |
| **software-development** | searchagent-development, plan, subagent-driven-development, writing-plans, software-development-methods | Partially (searchagent-development relevant) | **Keep** — searchagent-development critical for PCC integration |
| **research** | intelligence-repository, polymarket-microstructure, prediction-markets, research-knowledge-workflows, research-swarm | No | **Evaluate** — intelligence-repository could enrich PCC evidence pipeline |
| **social-media** | xurl | No | **Phase 5B candidate** — directly relevant to X provider integration |
| **devops** | hermes-development-operations, kanban-workflows, webhook-subscriptions | Partially (hermes-dev-ops loaded) | **Keep** — operational necessity |
| **mcp** | native-mcp | No | **Future** — MCP servers could provide additional data sources |
| **productivity** | linear, petdex, productivity-integrations | No | **Keep** — not relevant to PCC but low cost |
| **github** | github-workflows | No | **Keep** — useful for repo management |
| **media** | media-content-pipeline, spotify | No | **Keep** — media-content-pipeline could enrich news analysis |
| **creative** | baoyu-article-illustrator, baoyu-comic, creative-generation-studios, ideation, pixel-art, visual-design-artifacts | No | **Retire from PCC context** — not intelligence-relevant |
| **gaming** | minecraft-modpack-server, pokemon-player | No | **Retire from PCC context** — irrelevant to mission |
| **smart-home** | openhue | No | **Keep** — low cost, not harmful |
| **mlops** | dspy, mlops-model-lifecycle | No | **Future consideration** — DSPy could optimize prompts for PCC analysis |
| **data-science** | jupyter-live-kernel | No | **Future consideration** — could power velocity analytics |
| **apple** | apple-automation | No | **Keep** — not harmful, potential automation value |
| **red-teaming** | godmode | No | **Disable from PCC context** — security-relevant but not production-intelligence |

### Skills That Would Materially Improve Intelligence Quality (Without Changing PCC Architecture)

1. **`intelligence-repository`** — Could provide evidence-graded intelligence storage alongside PCC signals, creating a dual-ledger system (PCC signals + intelligence repository claims).
2. **`xurl`** — Direct X/Twitter API access for Phase 5B read-only provider integration without modifying PCC source code.
3. **`research-knowledge-workflows`** — Literature search and monitoring workflows that could feed into the morning/midday digest as enrichment.
4. **`media-content-pipeline`** — YouTube transcript extraction (via Agent Reach) for news analysis enrichment.
5. **`native-mcp`** — Could connect external data sources (news APIs, social media APIs) without modifying PCC code.

### Currently Unused Skills (Not Relevant to PCC Mission)

- `baoyu-article-illustrator`, `baoyu-comic`, `creative-generation-studios`, `ideation`, `pixel-art`
- `minecraft-modpack-server`, `pokemon-player`
- `petdex`, `spotify`, `openhue`, `godmode`
- `linear` (unless used for issue tracking)

---

## PART 5 — Provider Intelligence Audit

### Current Providers

| Provider | Type | Status | Enrichment Opportunity |
|----------|------|--------|----------------------|
| **RSS** | Curated feeds (BBC, NPR, NYT Politics) | ✅ Operational | Low — already curated, but could benefit from SearchAgent cross-reference |
| **News** | Google News RSS | ✅ Operational | Medium — SearchAgent `search()` could find additional news sources beyond Google's feed |
| **Crawl4AI** | Web crawler (stub) | ❌ NotImplemented | N/A — not producing signals yet |

### Should Hermes Enrich Provider Output?

**YES.** Here's the recommended enrichment pipeline:

```
RSS/News/Crawl4AI raw output
    ↓
SearchAgent search(query) — find additional sources on same topics
    ↓
SearchAgent fetch_many(urls) — independently verify key claims
    ↓
ResearchPacket generation — aggregate evidence, detect contradictions
    ↓
Multi-source synthesis — combine provider signals with SearchAgent findings
    ↓
Summarization — produce enriched intelligence for Chief of Staff
```

### Enrichment Capability Assessment

| Enrichment Layer | Available? | Impact on Intelligence Quality | Effort to Integrate |
|-----------------|-----------|-------------------------------|-------------------|
| **SearchAgent** | ✅ Fully implemented | HIGH — adds open-web search beyond curated feeds | MEDIUM — needs bridge layer between PCC providers and SearchAgent Python API |
| **Research pipeline** | ✅ Thin `research()` available | HIGH — structured evidence packets with contradictions | LOW — wrap existing `research(query)` in cron prompt |
| **Evidence aggregation** | ✅ Built into research() | HIGH — cross-reference signals across all providers | LOW — same as above |
| **Contradiction detection** | ✅ Shallow (Phase 4) | MEDIUM — flag conflicting reports before import | LOW — include in ResearchPacket output |
| **Multi-source synthesis** | ✅ Via fetch_many + research() | HIGH — combine RSS/News/Crawl4AI with web search results | MEDIUM — orchestration layer needed |
| **Summarization** | ✅ LLM-native capability | MEDIUM — condense enriched findings for operator | LOW — inherent in agent prompts |

---

## PART 6 — Mission Pipeline Trace

### Today's Complete Pipeline

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│ RSS Provider │────▶│ News Provider│────▶│ Crawl4AI (*) │
│ (BBC/NPR/NYT)│     │(Google News) │     │  (stub)      │
└─────────────┘     └─────────────┘     └──────────────┘
        │                   │                    │
        └───────────────────┼────────────────────┘
                            ↓
              ┌─────────────────────────┐
              │  Chief of Staff         │
              │  (signal aggregation)   │
              └─────────────────────────┘
                            ↓
              ┌─────────────────────────┐
              │  Hermes Import          │
              │  (normalize + store)    │
              └─────────────────────────┘
                            ↓
              ┌─────────────────────────┐
              │  Velocity Engine        │
              │  (alert/acceleration)   │
              └─────────────────────────┘
                            ↓
              ┌─────────────────────────┐
              │  Operator Dashboard     │
              └─────────────────────────┘
```

### Missing Hermes Capabilities in Pipeline

| Gap | Current State | Recommended Addition |
|-----|--------------|---------------------|
| **SearchAgent enrichment** | Not in pipeline | Add parallel branch: `search()` on each provider's top topics → enrich signals with additional sources |
| **Source verification** | None | Add `fetch_many()` step to independently verify key URLs from RSS/News before import |
| **Contradiction detection** | None | Add ResearchPacket generation after signal aggregation, flag contradictions before operator sees them |
| **Evidence grading** | None (all signals treated equally) | intelligence-repository skill could add evidence tiers (A-G) to PCC signals |
| **Freshness validation** | freshnessFilter.js exists but basic | Could be enhanced with SearchAgent date verification |

---

## PART 7 — Configuration Drift

### Comparison: Intended Architecture vs. Current State

| Component | Intended | Actual | Drift | Justification |
|-----------|---------|--------|-------|--------------|
| **PCC crons** | Active, daily schedule | All paused since 2026-06-20 | ⚠️ DISABLED | Paused intentionally; backend not running on port 3000 |
| **SearchAgent** | Core intelligence capability | Installed but NOT integrated into PCC pipeline | ⚠️ UNDER-UTILIZED | No bridge layer between JS providers and Python SearchAgent |
| **Crawl4AI provider** | Active web crawler | NotImplemented stub | ❌ MISSING FUNCTIONALITY | Stub registered but throws NotImplementedException |
| **X provider** | Read-only X data source (Phase 5B) | NotImplemented stub | ⚠️ PLANNED NOT IMPLEMENTED | Intended for Phase 5B, not expected to work yet |
| **Mock provider** | Fallback only | Registered in registry | ⚠️ AVAILABLE AS FALLBACK | Should be disabled for production use |
| **Fallback providers** | Configured fallback chain | Empty array `[]` | ❌ NOT CONFIGURED | No fallback if LM Studio goes down |
| **Polymarket swarm agents** | Hourly research cycle | All paused since 2026-06-22 | ⚠️ PAUSED (delivery errors) | `deliver=origin` has no target resolved |
| **Model routing** | Single primary model | qwen3.6-35b-a3b-mtp via LM Studio | ✅ Correct | Working as intended |
| **Personality system** | 14 personalities configured | All available in config | ✅ Configured | Not used in production crons (no personality specified) |

### Configuration Issues Summary

1. **Critical:** All PCC cron jobs are paused — no automated intelligence delivery is occurring.
2. **Critical:** Crawl4AI provider is a stub — one of the three core providers produces zero signals.
3. **Moderate:** No fallback provider configured — single point of failure at LM Studio.
4. **Moderate:** SearchAgent installed but not integrated — significant capability gap.
5. **Low:** Mock provider registered and available as fallback in production code path.

---

## PART 8 — Optimization Opportunities

### Immediate (Can be done without source changes)

| # | Opportunity | Impact | Effort | Notes |
|---|-----------|--------|--------|-------|
| 1 | **Resume PCC cron jobs** when backend is running | HIGH | LOW | Unpause crons, verify delivery works |
| 2 | **Add fallback provider** to config.yaml | MEDIUM | LOW | Add a second model/provider as backup |
| 3 | **Integrate SearchAgent into digest prompts** | HIGH | LOW | Modify cron job prompts (not source code) to invoke `search()` and `fetch_many()` |
| 4 | **Disable mock provider** in production path | MEDIUM | LOW | Prevent accidental use of mock data |

### Near-Term (Requires minimal integration work)

| # | Opportunity | Impact | Effort | Notes |
|---|-----------|--------|--------|-------|
| 5 | **Bridge layer: PCC → SearchAgent** | HIGH | MEDIUM | Create a thin wrapper that calls SearchAgent Python API from cron prompts |
| 6 | **ResearchPacket enrichment in digest** | HIGH | LOW | Cron prompt instructs agent to run `research()` on top topics before import |
| 7 | **Evidence aggregation across providers** | HIGH | MEDIUM | Cross-reference RSS/News/Crawl4AI signals with SearchAgent findings |
| 8 | **Configure delivery targets for swarm agents** | MEDIUM | LOW | Fix `deliver=origin` by connecting to a messaging platform |

### Future (Strategic improvements)

| # | Opportunity | Impact | Effort | Notes |
|---|-----------|--------|--------|-------|
| 9 | **Implement Crawl4AI provider** | HIGH | MEDIUM | Replace stub with functional web crawler |
| 10 | **Vector search / embeddings pipeline** | MEDIUM | HIGH | Enable semantic similarity for signal deduplication |
| 11 | **DSPy prompt optimization** | MEDIUM | MEDIUM | Auto-optimize digest/velocity prompts for quality |
| 12 | **MCP server integrations** | MEDIUM | MEDIUM | Connect external data sources (news APIs, social media) |

---

## PART 9 — Phase 5B Readiness Assessment

### Is Hermes Ready to Support a Read-Only X Provider?

**Architecturally: YES.**  
**Operationally: NO.**

#### Architectural Readiness

| Requirement | Status | Notes |
|------------|--------|-------|
| Provider registry supports plugin-style providers | ✅ Yes | `registerProvider()` pattern proven by RSS/News/Mock |
| xProvider.js stub exists | ✅ Yes | Registered, throws NotImplementedException (expected) |
| Cron infrastructure in place | ⚠️ Partially | Crons exist but are paused; delivery mechanism needs fixing |
| Import pipeline accepts new signal types | ✅ Yes | hermesImport.js normalizes any provider output |

#### Operational Readiness Gaps

1. **Crons are paused** — even if xProvider works, no cron will invoke it until crons are resumed.
2. **No X API credentials configured** — `xurl` skill exists but requires authentication setup.
3. **Delivery mechanism broken for swarm agents** — `deliver=origin` fails with "no delivery target resolved." This pattern would affect any new cron.
4. **Backend not running** — PCC server was confirmed not listening on port 3000 at audit start.

### Should SearchAgent Participate in Phase 5B?

**YES.** For X provider integration specifically:

- `search()` can discover trending topics and verify X content against broader web coverage
- `fetch_platform("https://x.com/...")` via Agent Reach can fetch specific X URLs (though this requires upstream tooling)
- `research()` can generate ResearchPackets combining X signals with RSS/News/Crawl4AI findings

### Should ResearchPacket Generation Occur?

**YES.** Before any signal enters the Operator dashboard:

```
X Provider → collectCandidates() → raw signals
    ↓
SearchAgent research(query) on top topics
    ↓
ResearchPacket (evidence + contradictions + open questions)
    ↓
Enriched signals with evidence grading
    ↓
Chief of Staff → Import → Velocity → Operator
```

### Should Evidence Aggregation Occur Before Import?

**YES.** This is the highest-impact optimization:

1. Collect raw signals from all providers (RSS, News, Crawl4AI, X)
2. Run SearchAgent `search()` on each provider's top topics
3. Run SearchAgent `fetch_many()` to independently verify key URLs
4. Generate ResearchPacket with evidence aggregation and contradiction detection
5. Import enriched signals (with source verification status) into PCC

### Recommended Optimal Architecture for Phase 5B

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ RSS      │ │ News     │ │ Crawl4AI │ │ X        │
│ Provider │ │ Provider │ │ Provider │ │ Provider │
└────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
     │             │            │            │
     └─────────────┼────────────┼────────────┘
                   ↓            ↓
      ┌──────────────────────────────────┐
      │  SearchAgent Enrichment Layer    │
      │  - search() on top topics        │
      │  - fetch_many() for verification │
      │  - research() for aggregation    │
      └──────────────┬───────────────────┘
                     ↓
      ┌──────────────────────────────────┐
      │  Chief of Staff (enriched)       │
      │  + Evidence grading              │
      │  + Contradiction flags           │
      └──────────────┬───────────────────┘
                     ↓
      ┌──────────────────────────────────┐
      │  Hermes Import (verified signals)│
      └──────────────┬───────────────────┘
                     ↓
      ┌──────────────────────────────────┐
      │  Velocity Engine                 │
      └──────────────┬───────────────────┘
                     ↓
      ┌──────────────────────────────────┐
      │  Operator Dashboard              │
      │  (enriched, verified intelligence)│
      └──────────────────────────────────┘
```

---

## SEARCHAGENT_UTILIZATION.md

### SearchAgent Status Summary

| Metric | Value |
|--------|-------|
| Package location | `/Users/sterlingdigital/hermes-peptide-intelligence/search_agent/` |
| Total files | 49 (including tests, docs, cache) |
| Test count | 28 passing |
| Implemented surfaces | 6 (search, source_registry, fetch, fetch_many, fetch_platform, research) |
| Used in PCC pipeline | **NO** — zero integration points |
| Used in peptide swarm | YES — as web search backbone |
| Live-verified queries | 3 (MrBeast retention, BPC-157 tendon healing, Polymarket CLOB) |

### Integration Gap Analysis

SearchAgent is a fully functional intelligence-gathering system that sits idle relative to Persona Command Center. The gap is not capability — it's integration:

1. **Language boundary:** PCC providers are JavaScript; SearchAgent is Python. A bridge layer (or cron-prompt-level invocation) is needed.
2. **API mismatch:** PCC expects `collectCandidates(persona, queryConfig)` returning candidate objects. SearchAgent returns `SearchResult`/`FetchResult`/`ResearchPacket` objects with different schemas.
3. **No orchestration hook:** There's no cron job or pipeline stage that invokes SearchAgent before signals reach the Chief of Staff.

### Recommended Integration Approach (No Source Code Changes)

Modify the digest cron prompts to instruct Hermes agents to:

1. After collecting RSS/News/Crawl4AI candidates, run `web_search()` for each persona's top topics
2. Use `web_extract()` on high-value URLs from search results
3. Synthesize findings into enriched signals before POSTing to `/api/hermes/import`

This leverages existing Hermes capabilities (web_search, web_extract) without requiring a Python bridge layer or source code changes.

---

## Definition of Done — Conclusive Answers

### 1. Is Hermes currently operating at full capability?

**NO.** Approximately 50% of installed capabilities are not being leveraged in the PCC pipeline:
- SearchAgent (6 surfaces, zero integration)
- Planning skill (available but unused)
- delegate_task subagent orchestration (available but unused for intelligence gathering)
- Research skills (intelligence-repository, research-knowledge-workflows — available but unused)

### 2. Are there installed capabilities not currently being leveraged?

**YES.** The following are installed but not used in the PCC pipeline:
- **SearchAgent** (highest impact — fully implemented, zero integration)
- **Planning skill** (`plan` — writes to `.hermes/plans/`)
- **Research skills** (`intelligence-repository`, `research-knowledge-workflows`, `research-swarm`)
- **Media content pipeline** (`media-content-pipeline` — YouTube transcripts, GIF search)
- **MCP native client** (`native-mcp` — external data source connections)
- **DSPy** (`dspy` — prompt optimization for PCC analysis)

### 3. Should SearchAgent become part of the daily intelligence gathering pipeline?

**YES.** SearchAgent should be integrated into both Morning and Midday digests as an enrichment layer:
- `search()` adds open-web coverage beyond curated RSS feeds
- `fetch_many()` provides independent source verification
- `research()` generates structured evidence packets with contradiction detection
- Agent Reach expands platform diversity (YouTube, Reddit, GitHub, X)

### 4. Are there Hermes skills or built-in tools that would significantly improve intelligence quality before Phase 5B?

**YES — prioritized:**
1. **`intelligence-repository`** — Evidence-graded storage alongside PCC signals
2. **`xurl`** — Direct X API access for Phase 5B provider integration
3. **`research-knowledge-workflows`** — Literature search and monitoring workflows
4. **SearchAgent `web_search()` + `web_extract()`** — Available now, no skill needed

### 5. What is the optimal Hermes configuration before integrating the X provider?

**Recommended pre-Phase-5B configuration:**

1. **Resume PCC cron jobs** (morning-validation, morning-digest, midday-validation, midday-digest, velocity-scan)
2. **Add fallback provider** to `config.yaml` (second model/provider for redundancy)
3. **Integrate SearchAgent enrichment** into digest cron prompts (invoke `web_search()` + `web_extract()` on top topics)
4. **Disable mock provider** from production path
5. **Fix delivery mechanism** — configure a messaging platform target so `deliver=origin` works
6. **Load `intelligence-repository` skill** for evidence-graded signal storage
7. **Configure X API credentials** via `xurl` skill before enabling xProvider

---

## Audit Metadata

| Field | Value |
|-------|-------|
| Audit date | 2026-06-27 |
| Hermes profile | default |
| Primary provider | lmstudio (qwen3.6-35b-a3b-mtp) |
| Total cron jobs | 13 (all paused) |
| Active scheduled jobs | 0 |
| Total skills installed | 42 across 16 categories |
| PCC providers registered | 6 (RSS, News, Mock, Crawl4AI-stub, X-stub, Reddit-stub) |
| PCC providers operational | 2 (RSS, News) |
| SearchAgent surfaces implemented | 6 |
| SearchAgent surfaces used in PCC | 0 |

---

*End of Hermes Capability & Production Operations Audit.*
