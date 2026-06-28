# PCC-Hermes Data Connection Validation

## Summary

Validation of the data flow from Persona Watch Lists (PCC) through Hermes retrieval, Opportunity Packets, and Operator dashboard.

**Overall Verdict: PARTIAL** — 38 PASS, 3 PARTIAL, 1 FAIL

## Watch List Data (PASS)

All 4 personas have correctly configured Watch Lists with domain-appropriate entities:

| Persona | Entities | Domain Match |
|---------|----------|-------------|
| Sterling Digital | 10 | 10/10 in-domain |
| Scott Decoded | 10 | 10/10 in-domain |
| Peptide Tracker | 10 | 10/10 in-domain |
| Chris Klebl | 11 | 10/11 (Karpathy is intentional cross-persona) |

Total tracked entities: 40. All handles normalized with `@`. All entity IDs preserved.

## Hermes Export (PASS)

`GET /api/hermes/export` returns:
- 4 personas with `trackedEntities` arrays
- 40 tracked entities with normalized handles
- All subscriptions include `entity_id` references

## Data Flow Assessment

### 1. PCC Persona Data → Hermes Retrieval: FAIL

Hermes ingestion pipeline reads from `persona_queries` (static text strings), NOT from `tracked_entities` or `persona_entity_subscriptions`. Watch List data exists in the database and Hermes export but is completely disconnected from the ingestion pipeline.

### 2. Hermes Retrieval → Opportunity Packet Creation: PARTIAL

No automated Opportunity Engine exists. Manual signal creation via `POST /api/hermes/import` works correctly — 4 trial signals were successfully imported. Signals are normalized, deduplicated, and persisted with `velocity_alerts` generation.

### 3. Opportunity Packet → PCC Operator Dashboard: PARTIAL

Trial signals appear correctly in `GET /api/operator/queue` — all 4 personas show their trial signals. Dashboard rendering depends on frontend implementation.

### 4. Watch List Matching: PARTIAL

All 4 trial signals match their respective Watch List entities:
- Paul Graham → Sterling Digital
- Andrej Karpathy → Scott Decoded
- Bryan Johnson → Peptide Tracker
- Morgan Housel → Chris Klebl

## Key Gaps

1. **X Provider**: `src/providers/xProvider.js` throws `NotImplemented` — no X API credentials configured.
2. **Watch List → Ingestion**: `src/ingestion/pipeline.js` queries `persona_queries`, not `tracked_entities`.
3. **Opportunity Engine**: No automated signal generation from Watch List data exists.
