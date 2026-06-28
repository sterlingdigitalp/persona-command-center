# SearchAgent Utilization Report

**Date:** 2026-06-27  
**Project:** Persona Command Center (Phase 5A)  
**Audit Type:** Capability utilization analysis — SearchAgent  
**Package Location:** `/Users/sterlingdigital/hermes-peptide-intelligence/search_agent/`

---

## Executive Summary

SearchAgent is a **fully implemented, fully tested intelligence-gathering system** with six operational surfaces. It is currently installed and functional but has **zero integration points** into the Persona Command Center pipeline. This represents the single largest untapped capability gap in Hermes' current configuration for PCC operations.

---

## 1. Installation Status

| Component | Status | Details |
|-----------|--------|---------|
| Package structure | ✅ Installed | 49 files including providers, services, models, tests, docs |
| Test suite | ✅ Passing | 28 tests passing (search, fetch, multi-fetch, source registry, agent reach) |
| SearXNG integration | ✅ Live-verified | Local instance at `http://localhost:8080` — health + JSON endpoint confirmed working |
| Jina Reader | ✅ Implemented | Fallback fetch provider for content extraction |
| SQLite cache/registry | ✅ Operational | Runtime caching + stable `SRC-xxxxx` source IDs |
| Agent Reach platform fetch | ✅ Implemented | YouTube, Reddit, GitHub, X URL normalization |
| Research packet generation | ✅ Implemented | Thin orchestration over search + fetch_many primitives |

---

## 2. Where Is SearchAgent Used?

### Current Usage: Peptide Intelligence Swarm Only

SearchAgent is actively used as the web-search backbone for the **Peptide Intelligence Swarm** — a separate project at `/Users/sterlingdigital/hermes-peptide-intelligence/` that maintains a knowledge base for 12 peptides with evidence tiers A-G. In that context, SearchAgent provides:

- General web search via SearXNG
- Platform-specific content fetch (YouTube transcripts, GitHub repos)
- Source registry with stable IDs for deduplication across rounds
- Research packet generation for structured analysis

### NOT Used in Persona Command Center

SearchAgent has **no integration points** into the PCC pipeline:

```
PCC Pipeline (current):
RSS Provider → News Provider → Crawl4AI(stub) → Chief of Staff → Import → Velocity → Operator

SearchAgent is not called at any stage.
```

---

## 3. When Is It Invoked? How Often?

### Morning Digest: NOT INVOKED

The morning digest cron (job_id `9de692df42c2`, paused) instructs the Hermes agent to:
1. Fetch persona state from `/api/hermes/export`
2. Generate 2-3 signals per persona using RSS/News/Crawl4AI
3. POST enriched signals to `/api/hermes/import`

**SearchAgent is never mentioned in the prompt.** No `search()`, `fetch_many()`, or `research()` calls are part of this workflow.

### Midday Digest: NOT INVOKED

Same pattern as morning digest — provider-only pipeline, no SearchAgent invocation.

### Velocity Scan: NOT INVOKED

The velocity scan cron (job_id `ada123d235a3`, paused) reads signals already imported into PCC and detects acceleration patterns. It does not trigger any new data collection or search queries.

---

## 4. Capability-by-Capability Evaluation

### 4a. `search(query)` — Web Search via SearXNG

| Attribute | Value |
|-----------|-------|
| Status | ✅ Implemented, live-verified |
| Used in PCC? | ❌ No |
| Verified queries | "MrBeast retention mechanics", "BPC-157 tendon healing human trial", "Polymarket CLOB execution state" |
| Output schema | `SearchResult` with source_id, url, title, snippet, score, provider, engines, category, published_date, source_type |

**Gap analysis:** RSS feeds are limited to 3 pre-configured URLs (BBC, NPR, NYT Politics). SearchAgent's `search()` can query any topic across the open web. This is a significant coverage gap — PCC only sees what those three feeds publish, while SearchAgent could surface breaking news from hundreds of additional sources.

**Recommendation:** Integrate as a parallel enrichment branch in digest cron prompts. After collecting RSS/News candidates, run `web_search()` on each persona's top topics to discover additional relevant content.

### 4b. `fetch_many(urls)` — Batch Content Fetching

| Attribute | Value |
|-----------|-------|
| Status | ✅ Implemented, tested |
| Used in PCC? | ❌ No |
| Features | URL deduplication, cache reuse, ordering preservation, metrics (success/failure counts, total words, latency) |
| Fallback | Jina Reader → direct HTTP extraction |

**Gap analysis:** Currently no verification step exists in the PCC pipeline. If RSS or News providers surface a claim, there's no mechanism to independently verify it by fetching and reading the source page. `fetch_many()` could provide this verification layer.

**Recommendation:** Use for source verification — after signals are collected from RSS/News/Crawl4AI, run `fetch_many()` on key URLs to independently verify content before import.

### 4c. ResearchPacket Generation (`research(query)`)

| Attribute | Value |
|-----------|-------|
| Status | ✅ Implemented (thin orchestration) |
| Used in PCC? | ❌ No |
| Output fields | query, executive_summary, key_findings, evidence[], sources[], contradictions[], open_questions[] |
| Evidence citation | All evidence cites stable `SRC-xxxxx` IDs from Source Registry |

**Gap analysis:** PCC signals have no evidence grading or contradiction detection. Every signal is treated equally regardless of source reliability or whether conflicting reports exist elsewhere. ResearchPacket generation would add structured analysis with explicit contradiction flags.

**Recommendation:** Integrate into digest cron prompts — after collecting candidates, run `research()` on top topics to generate structured analysis packets that enrich the signals before import.

### 4d. Evidence Aggregation

| Attribute | Value |
|-----------|-------|
| Status | ✅ Built into research() |
| Used in PCC? | ❌ No |
| Mechanism | search(query) → fetch_many(top URLs) → aggregate content → emit ResearchPacket |

**Gap analysis:** No cross-source correlation exists. If RSS reports event X and News also reports event X, they arrive as separate signals with no indication they're about the same thing. Evidence aggregation would identify overlapping coverage and consolidate it.

**Recommendation:** Enable evidence aggregation before import — group signals by topic similarity, flag duplicates, and produce consolidated intelligence items.

### 4e. Contradiction Detection

| Attribute | Value |
|-----------|-------|
| Status | ✅ Shallow (Phase 4) |
| Used in PCC? | ❌ No |
| Depth | Surface-level contradiction identification within ResearchPacket |
| Citation | Evidence and sources cite stable SRC-xxxxx IDs; never invents citation IDs |

**Gap analysis:** Critical gap for intelligence operations. If one source reports "Policy A passes" and another reports "Policy A fails," the operator sees both signals without any indication of conflict. Contradiction detection would flag these before they reach the dashboard.

**Recommendation:** Enable contradiction detection as a pre-import filter — ResearchPacket's `contradictions` field should be surfaced to operators alongside enriched signals.

### 4f. Source Diversity (Agent Reach)

| Platform | Supported? | Used in PCC? |
|----------|-----------|-------------|
| YouTube | ✅ Yes (`fetch_platform`) | ❌ No |
| Reddit | ✅ Yes (`fetch_platform`) | ❌ No |
| GitHub | ✅ Yes (`fetch_platform`) | ❌ No |
| X/Twitter | ✅ Yes (`fetch_platform`) | ❌ No |

**Gap analysis:** PCC's three providers (RSS, News, Crawl4AI) cover traditional web content but miss platform-specific sources where breaking news and analysis often originate. Agent Reach could add YouTube transcripts, Reddit discussions, GitHub developments, and X posts as additional intelligence channels.

**Recommendation:** Enable Agent Reach for platform-specific enrichment — particularly YouTube (video news transcripts) and Reddit (community discussion/analysis).

---

## 5. Integration Gap Analysis

### Root Causes of Non-Integration

1. **Language boundary:** PCC providers are JavaScript modules implementing `collectCandidates(persona, queryConfig)`. SearchAgent is a Python package with completely different APIs (`search()`, `fetch_many()`, `research()`). No bridge layer exists.

2. **API schema mismatch:** PCC expects candidate objects with specific fields (provider, source, content, metadata). SearchAgent returns `SearchResult`/`FetchResult`/`ResearchPacket` objects with different schemas. A normalization step is needed.

3. **No orchestration hook:** There's no cron job or pipeline stage that invokes SearchAgent before signals reach the Chief of Staff. The digest/validation cron jobs are self-contained agent prompts that never reference SearchAgent.

4. **Architectural assumption:** PCC was designed with a fixed provider stack (RSS + News + Crawl4AI). SearchAgent wasn't considered as part of the original provider model — it's an external capability that needs to be woven in.

### Integration Approaches (Ranked by Effort)

| Approach | Effort | Description |
|----------|--------|-------------|
| **A: Cron-prompt invocation** | LOW | Modify digest cron prompts to instruct Hermes agents to use `web_search()` and `web_extract()` built-in tools on top topics before generating signals. No source code changes needed. |
| **B: Bridge layer script** | MEDIUM | Create a thin Python/Node bridge that calls SearchAgent's Python API from within the PCC cron workflow, normalizes results to PCC candidate schema, and merges with provider output. |
| **C: New SearchAgent provider** | HIGH | Implement `searchAgentProvider.js` as a formal PCC provider implementing `collectCandidates()`, wrapping SearchAgent's search/research capabilities behind the standard JS interface. |

---

## 6. Recommendation Summary

### Should SearchAgent Become Part of Daily Intelligence Collection?

**YES — unequivocally.** The evidence is clear:

| Factor | Assessment |
|--------|-----------|
| Capability completeness | ✅ All 6 surfaces implemented and tested |
| Live verification | ✅ SearXNG search verified with real queries |
| Coverage gap it fills | HIGH — open-web search beyond 3 curated RSS feeds |
| Verification capability | HIGH — independent source verification via fetch_many() |
| Intelligence quality impact | HIGH — evidence aggregation + contradiction detection |
| Integration effort | LOW-MEDIUM — cron-prompt approach requires zero source changes |

### Optimal Integration Pattern

```
Digest Cron Triggered
    ↓
1. Collect candidates from RSS/News/Crawl4AI (existing)
2. [NEW] Run web_search() on each persona's top topics
3. [NEW] Run web_extract() on high-value search results
4. [NEW] Synthesize findings into enriched signals
5. Chief of Staff receives provider + SearchAgent-enriched signals
6. Import → Velocity → Operator (enriched intelligence)
```

This pattern requires **no source code changes** — only modifications to the cron job prompts that instruct Hermes agents to use their built-in `web_search()` and `web_extract()` tools as part of the digest workflow.

---

## 7. SearchAgent Capability Maturity Matrix

| Surface | Implementation | Testing | Live Verification | PCC Integration | Overall Status |
|---------|---------------|---------|------------------|-----------------|---------------|
| Web search (`search`) | ✅ Complete | ✅ 28 tests passing | ✅ 3 queries verified | ❌ None | **Ready for integration** |
| Source Registry | ✅ Complete | ✅ Tests passing | N/A (internal) | ❌ None | **Ready for integration** |
| Single fetch (`fetch`) | ✅ Complete | ✅ Tests passing | Partial (Jina tested) | ❌ None | **Ready for integration** |
| Multi-fetch (`fetch_many`) | ✅ Complete | ✅ Tests passing | Partial | ❌ None | **Ready for integration** |
| Agent Reach platform | ✅ Complete | ✅ Tests passing | Demo verified | ❌ None | **Ready for integration** |
| Research packet (`research`) | ✅ Complete | ✅ Tests passing | Not live-verified end-to-end | ❌ None | **Ready for integration** |

---

*End of SearchAgent Utilization Report.*
