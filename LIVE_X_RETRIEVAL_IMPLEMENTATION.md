# Phase 5B.2 — Live X API Retrieval Implementation

## Goal
Replace placeholder NotImplemented X retrieval with production X API v2 Bearer Token integration.

## Files Changed

### `src/providers/xProvider.js` (rewritten)
- **Before**: `collectCandidates()` threw `Error("NotImplemented")` — placeholder stub that crashed any pipeline path attempting X retrieval.
- **After**: Full X API v2 implementation with three endpoints:
  - `POST /2/users/by` — batch user lookup (resolves X usernames to user IDs)
  - `GET /2/users/{id}/tweets` — fetches recent tweets for an account
  - `GET /2/users/{id}/mentions` — fetches recent mentions for an account
- **Auth**: Bearer Token from `X_BEARER_TOKEN` env var (no OAuth signing — read-only access)
- **Error handling**: Structured `retrievalStatus` field:
  - `"no_credentials"` — `X_BEARER_TOKEN` not set
  - `"auth_failed"` — HTTP 401 from X API
  - `"rate_limited"` — HTTP 429 from X API
  - `"api_error"` — network/non-2XX errors
- **Graceful degradation**: When `options.ignoreProviderErrors === true`, returns empty `[]` instead of throwing (used by pipeline for non-critical X data).

### `scripts/verify-x-api-readiness.js` (updated)
- Added 5 new production retrieval checks (was 12, now 17):
  - `X provider implements live X API v2 retrieval` — verifies `xProvider.js` uses X API v2 Bearer Token
  - `X provider returns structured error on auth failure` — verifies structured error handling
  - `X provider replaces NotImplemented stub` — verifies no NotImplemented thrown
  - `X API v2 network endpoints are called from xProvider` — verifies `api.twitter.com/2` calls
  - `X_BEARER_TOKEN is read at runtime` — verifies env var is consumed
- Updated README check: now looks for `X_BEARER_TOKEN` instead of legacy "does not call X API" text.

### `scripts/verify-live-watchlist-retrieval.js` (new)
- 8-check validation that proves:
  1. X provider is registered and callable
  2. No NotImplemented in production path
  3. Without credentials: returns `retrievalStatus: "no_credentials"` (not mock/data)
  4. With `ignoreProviderErrors`: returns `[]` gracefully (not false/placeholder)
  5. With `X_BEARER_TOKEN`: live retrieval succeeds for all 4 test entities (Andrej Karpathy, Paul Graham, Bryan Johnson, Morgan Housel)
- Fails on: placeholder retrieval, False returned, empty array returned, mock_x used, NotImplemented reached.
- Passes only when live X API retrieval succeeds.

### `package.json` (updated)
- Added `"verify:live-watchlist-retrieval": "node scripts/verify-live-watchlist-retrieval.js"` script

### `README.md` (updated)
- Phase 5 section now documents X API retrieval workflow instead of "does not require X credentials / does not call X API"
- Updated to describe Bearer Token configuration and graceful fallback.

## Placeholder Functions Removed
- `NotImplemented` throw in `xProvider.js` `collectCandidates()` — replaced with real Bearer Token auth flow

## Production Retrieval Path
```
Pipeline (entity with monitor_x=true)
  → collectCandidatesForQuery({ provider: "x" })
    → xProvider.collectCandidates(query)
      → Read X_BEARER_TOKEN from env
      → POST /2/users/by (resolve handle → user ID)
      → GET /2/users/{id}/tweets (recent tweets)
      → GET /2/users/{id}/mentions (recent mentions)
      → Return structured candidate array
  → Freshness filter → Scoring → Hermes digest
```

## Failure Modes
| Scenario | Behavior | Status |
|---|---|---|
| No `X_BEARER_TOKEN` | Throws with `retrievalStatus: "no_credentials"` | Graceful |
| `ignoreProviderErrors` + no token | Returns `[]` | Graceful |
| Invalid token (401) | Throws with `retrievalStatus: "auth_failed"` | Reportable |
| Rate limited (429) | Throws with `retrievalStatus: "rate_limited"` | Reportable |
| Network error | Throws with `retrievalStatus: "api_error"` | Reportable |
