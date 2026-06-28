# Watch List Ingestion Validation

## Proof: Persona → Watch List → Opportunity Engine

### 1. Persona Watch List Data (PASS — 7 checks)

- 4 personas exist
- Scott Decoded has 10 Watch List entities
- Andrej Karpathy is in Scott Decoded's Watch List (handle: @karpathy)
- Karpathy's `monitor_x` and `monitor_rss` flags are active

### 2. Opportunity Engine Uses Watch List (PASS — 4 checks)

The provider-backed morning digest was run with mock providers:

- Digest produced 12 signals across 3 active personas
- Scott Decoded has 3 signals in digest output
- **3/3 signal queries contain Watch List entity data** (@karpathy)
- **Zero legacy persona_query text found** — no "Supreme Court ethics", "federal budget reconciliation", or "education policy" in signals

### 3. Hermes Export Unchanged (PASS — 4 checks)

- 4 personas exported
- 40 tracked entities exported
- 13 legacy personaQueries still exported (backward compat)
- All personas have trackedEntities array

### 4. Entity Round Trip (PASS — 2 checks)

- Karpathy entity exists in `/api/entities`
- 4 signals reference Karpathy from Watch List ingestion

## Regression Results

| Test | Result |
|------|--------|
| `npm run build` | PASS |
| `npm run typecheck` | PASS |
| `npm test` (smoke-test) | PASS |
| `verify:persona-intelligence-config` | PASS (36/36) |
| `verify:watchlist-ingestion` | PASS (17/17) |

## Key Findings

1. **Watch List is now the single source of truth** for production ingestion.
2. **`persona_queries` CRUD still works** but is no longer consumed by the ingestion pipeline.
3. **Hermes export unchanged** — includes both tracked entities and legacy queries.
4. **No database schema changes** — only ingestion source logic changed.
5. **Backward compatible** — empty Watch Lists fall back to persona niche.
