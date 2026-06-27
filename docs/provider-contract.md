# Provider Contract

**Version:** 2026-06-phase4g (Provider Registry)

## Purpose
This document defines the stable interface for all data providers in Persona Command Center.
Providers are plug-in modules. The ingestion pipeline, scoring, clustering, deduplication, angle generation, Chief of Staff, Hermes import, and velocity engine are **provider-agnostic**.

Adding a new provider (Crawl4AI, X, Reddit, etc.) requires:
1. Implementing one provider file.
2. Registering it (import + self-register).
3. Done.

No modifications to pipeline, scoring, velocity, chiefOfStaff, hermes orchestration, or dashboard are needed.

## Provider Interface

Every provider **MUST** export:

```js
export async function collectCandidates(persona, queryConfig, options = {}) 
```

### Parameters
- `persona`: object with at minimum `{ id, name, niche, ... }` (from DB)
- `queryConfig`: object from persona_queries, shape:
  ```ts
  {
    id?: string,
    query: string,
    provider: string,   // e.g. "rss", "news", "crawl4ai"
    weight?: number,
    // provider-specific extras allowed (e.g. feedUrl, feedUrls)
  }
  ```
- `options`: runtime options (timeoutMs, maxFeeds, ignoreProviderErrors, allowMock, etc.)

### Return Value
Must return `Promise<Array<Candidate>>` where each `Candidate` is:

```ts
interface Candidate {
  topic: string;        // primary headline / key phrase (required)
  title: string;        // same as topic for compatibility (required)
  summary: string;      // cleaned text content
  url: string;          // canonical source URL (required for dedupe)
  source: string;       // hostname or origin label
  provider: string;     // the provider name (e.g. "rss")
  publishedAt: string;  // ISO8601 timestamp (best effort)
  rawData?: object;     // provider-specific metadata (opaque to pipeline)
}
```

- All fields should be present and sane. Empty/invalid items may be filtered upstream.
- `rawData` may contain provider hints such as `hasPublishedAt`, `mock`, `query`, `weight`, etc.
- The pipeline treats `rawData` as opaque except for a few well-known optional flags (see below).

### Standardized rawData flags (optional, recommended)
- `hasPublishedAt: boolean` — whether the source supplied a usable date (used by freshness filter)
- `mock: boolean` — marks mock/test data
- `providerKind?: string` — e.g. "google_news_rss"

## Registration

Providers self-register:

```js
// in src/providers/myProvider.js
import { registerProvider } from "./registry.js";

export async function collectCandidates(...) { ... }

registerProvider("myprovider", collectCandidates);
```

Bootstrap in `src/providers/index.js`:

```js
import "./myProvider.js";
// ...
```

## Registry API

```js
import {
  registerProvider,
  getProvider,
  listProviders,
  collectCandidatesForQuery
} from "./providers/index.js";   // or "./providers/registry.js"

registerProvider(name, fn);
const fn = getProvider(name);
const names = listProviders();
const candidates = await collectCandidatesForQuery(persona, queryConfig, options);
```

`collectCandidatesForQuery` will throw a clear error for unknown providers:

```
Unknown provider "crawl4ai". Registered providers: rss, news, mock, ...
```

## Validation
- `normalizeProvider` (server) and `normalizeProviderNames` (Hermes) validate against the live registry via `getProvider` / `listProviders`.
- Unknown providers are rejected with the list of available ones.
- Hardcoded allowlists ["rss","news","mock"] have been removed.

## Freshness, Mock, and Date handling
- Mock detection lives inside the mock provider (MOCK_HOSTS + isMockSource).
- Freshness filter delegates to provider-owned logic.
- Date validity (`hasPublishedAt`) is a convention, not RSS-specific. Any provider that fails to provide a usable `publishedAt` triggers the same "missingDate" path.

## Defaults
- Implicit default of "news" has been removed.
- Use `config/defaultProviders.js` → `getDefaultProviders()` → `["rss", "news"]`
- Hermes morning-digest and pipeline use configured defaults.

## Guarantees for Pipeline Consumers
After `collectCandidates` returns, the following modules receive **only normalized candidates** and perform **zero provider-specific branching**:
- pipeline.js
- dedupe.js
- cluster.js
- scoring.js
- angleEngine.js
- chiefOfStaff.js
- hermesImport.js
- velocity/* (alertEngine, snapshotEngine, accelerationEngine)

## Adding a New Provider Checklist
1. `src/providers/coolNewProvider.js`:
   - Implement `collectCandidates`
   - `registerProvider("coolnew", collectCandidates)`
2. Add one import line in `src/providers/index.js`
3. Optionally add query entries with `provider: "coolnew"`
4. Run existing tests (no breakage to other providers)

## Example Minimal Provider
```js
import { registerProvider } from "./registry.js";

export async function collectCandidates(persona, queryConfig, options = {}) {
  // fetch, parse, return Candidate[]
  return [];
}

registerProvider("coolnew", collectCandidates);
```

## Versioning
Contract changes will be documented here. Current providers (rss, news, mock) conform.

See also: CRAWL4AI_PROVIDER_READINESS.md (pre-refactor state).
