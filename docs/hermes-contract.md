# Hermes Payload Contract

Version: `2026-06-phase4a`

Hermes is an external intelligence service. Persona Command Center remains the source of truth for persistence, review, drafts, scheduling, and audit logging.

## Import Endpoint

```http
POST /api/hermes/import
content-type: application/json
```

Hermes may import a complete payload directly, but production morning digest jobs should prefer the provider-backed route below so the app can use its configured public-feed providers.

## Provider-Backed Morning Digest Endpoint

```http
POST /api/hermes/morning-digest/run
content-type: application/json
```

Request:

```json
{
  "provider": "lmstudio",
  "model": "qwen3.6-35b-a3b-mtp",
  "endpoint": "http://localhost:1234/v1",
  "jobName": "persona-command-center-morning-digest",
  "maxSignalsPerPersona": 3,
  "providers": ["rss", "news"]
}
```

Defaults:

- `provider`: `HERMES_PROVIDER` or `lmstudio`
- `model`: `HERMES_MODEL` or `qwen3.6-35b-a3b-mtp`
- `endpoint`: `HERMES_ENDPOINT` or `http://localhost:1234/v1`
- `jobName`: `persona-command-center-morning-digest`
- `maxSignalsPerPersona`: `3`
- `providers`: `["rss", "news"]`

Production digest rules:

- `providers` defaults to `["rss","news"]`.
- `mock` is test/dev only and is ignored unless `allowMock=true` is explicitly sent or `NODE_ENV=test`.
- Candidate freshness is based on original `publishedAt`.
- Candidates missing a valid `publishedAt` are rejected.
- Candidates older than 72 hours are rejected.
- Updated/revised/archive-style old content is rejected, including obvious markers such as `updated:`, `originally published`, `first published`, `revised`, `correction`, `from the archive`, `last year`, and stale year markers.
- Mock and fixture domains such as `mock-public-news.example`, `mock-rss-feed.example`, `example.test`, and `hermes.local` are rejected in production digest runs.

Behavior:

- loads personas and active persona queries
- collects candidates through the existing RSS/news provider layer
- filters to fresh, real, non-mock candidates from the last 72 hours
- deduplicates, clusters, scores, and generates deterministic angles
- applies the deterministic Chief of Staff selector
- imports selected signals as Hermes `morning_digest` signals
- persists provider, model, endpoint, job name, run type, scores, source counts, evidence URLs, and score history

Response:

```json
{
  "runId": "run_123",
  "providerNames": ["rss", "news"],
  "candidateCount": 42,
  "staleFilteredCount": 9,
  "mockFilteredCount": 0,
  "missingDateFilteredCount": 3,
  "freshCandidateCount": 30,
  "dedupedCount": 35,
  "clusterCount": 18,
  "signalCount": 12,
  "signalsCreated": 8,
  "signalsUpdated": 4,
  "topSignalsByPersona": [],
  "attribution": {
    "provider": "lmstudio",
    "model": "qwen3.6-35b-a3b-mtp",
    "endpoint": "http://localhost:1234/v1",
    "jobName": "persona-command-center-morning-digest"
  }
}
```

```http
GET /api/hermes/morning-digest/latest
```

Returns the latest provider-backed morning digest run summary. Hermes cron should call `POST /api/hermes/morning-digest/run` instead of inventing or importing mock morning digest signals.

```http
GET /api/hermes/morning-digest/latest?compact=true
```

Returns a compact verification shape without `rawCluster`, `rawData`, or full candidate arrays. Compact `topSignalsByPersona` includes only persona id, summary, signal count, and signal topic, source, published date, priority score, evidence URLs, and Hermes attribution.

## Export Endpoint

```http
GET /api/hermes/export
```

Returns the current app state Hermes should consume:

```json
{
  "contractVersion": "2026-06-phase4a",
  "exportedAt": "2026-06-16T10:45:00.000Z",
  "personas": [],
  "personaQueries": [],
  "recentSignals": [],
  "hermesSettings": {}
}
```

Hermes should treat this export as read-only context. The app remains the source of truth.

## Required Payload

```json
{
  "version": "2026-06-phase4",
  "runType": "morning_digest",
  "provider": "lmstudio",
  "model": "qwen3.6-35b-a3b-mtp",
  "endpoint": "http://localhost:1234/v1",
  "jobName": "persona-command-center-morning_digest",
  "generatedAt": "2026-06-16T10:45:00.000Z",
  "personas": [
    {
      "personaId": "policy-pete",
      "signals": [
        {
          "topic": "Student loan repayment rule changes hit implementation reality",
          "source": "Hermes",
          "sourceProvider": "Hermes",
          "query": "education policy student loans",
          "firstSeenAt": "2026-06-16T10:20:00.000Z",
          "lastSeenAt": "2026-06-16T10:45:00.000Z",
          "velocityScore": 82,
          "relevanceScore": 91,
          "noveltyScore": 76,
          "freshnessScore": 96,
          "riskScore": 14,
          "priorityScore": 88,
          "sourceCount": 4,
          "clusterId": "hermes-morning_digest-policy-pete-1",
          "suggestedAngle": "PolicyPete: use implementation reality to frame the rule change.",
          "evidenceUrls": ["https://example.com/story"],
          "rawData": {}
        }
      ]
    }
  ]
}
```

## Attribution

Hermes payloads must include top-level attribution:

```json
{
  "provider": "lmstudio",
  "model": "qwen3.6-35b-a3b-mtp",
  "endpoint": "http://localhost:1234/v1",
  "jobName": "persona-command-center-morning_digest"
}
```

The app inherits these values onto every imported signal. A signal may override any attribution field when it was produced by a different provider, model, endpoint, or job:

```json
{
  "topic": "Hermes Override Attribution Signal",
  "source": "Hermes",
  "provider": "signal-provider",
  "model": "signal-model",
  "endpoint": "http://signal-endpoint/v1",
  "jobName": "signal-job",
  "suggestedAngle": "PolicyPete: attribution override confirmed."
}
```

Local defaults are applied as a final fallback for development:

- `HERMES_PROVIDER`, default `lmstudio`
- `HERMES_MODEL`, default `qwen3.6-35b-a3b-mtp`
- `HERMES_ENDPOINT`, default `http://localhost:1234/v1`
- `HERMES_JOB_NAME`, default `hermes-intelligence-job`

No Hermes-generated signal should store empty attribution during normal operation.

## Run Types

- `morning_digest`: creates the morning briefing and top signals per persona.
- `velocity_scan`: updates acceleration and priority scores.
- `midday_brief`: identifies emerging opportunities.
- `evening_scan`: updates scores and prepares older signals for archiving.
- `validation_ping`: proves real Hermes-compatible connectivity and attribution.

## Validation Ping

`validation_ping` payloads must include model attribution:

```json
{
  "version": "2026-06-phase4a",
  "runType": "validation_ping",
  "jobName": "hermes-connectivity-validation",
  "provider": "lmstudio",
  "model": "qwen3.6-35b-a3b-mtp",
  "endpoint": "http://localhost:1234/v1",
  "generatedAt": "2026-06-16T10:45:00.000Z",
  "validationId": "validation_123",
  "personas": [
    {
      "personaId": "policy-pete",
      "signals": [
        {
          "topic": "Hermes Validation Signal",
          "source": "Hermes",
          "suggestedAngle": "PolicyPete: validation round trip confirmed."
        }
      ]
    }
  ]
}
```

The app persists:

- provider
- model
- endpoint
- jobName
- validationId

## Validation Rules

- `runType` is required and must be one of the supported run types.
- `generatedAt` is required and must parse as a date.
- `personas` is required and must be an array.
- Each persona entry must include `personaId`.
- Each persona entry must include a `signals` array.
- Each signal must include `topic`, `source`, and `suggestedAngle`.
- Top-level `provider`, `model`, `endpoint`, and `jobName` are required for production Hermes payloads.
- Signal-level `provider`, `model`, `endpoint`, and `jobName` override top-level attribution when present.
- `validation_ping` requires `jobName`, `provider`, `model`, `endpoint`, and `validationId`.
- Scores are optional but should be integers from `0` to `100`; omitted scores receive safe defaults.
- `evidenceUrls` should be an array of public URLs.

## Import Behavior

The app will:

- validate the payload
- normalize each Hermes signal
- deduplicate against recent non-archived signals
- update matching signals when duplicates are found
- insert new signals when no duplicate is found
- insert `signal_snapshots` for score history on every import/update
- create an `ingestion_runs` row
- write audit events
- persist provider, model, endpoint, job name, run type, and validation id attribution

## Deduplication

Signals are considered duplicates when they belong to the same persona and either:

- share a `clusterId`, or
- have high topic similarity against a recent non-archived signal.

Duplicates update scores and create a new snapshot instead of creating a second visible signal.

## Source Of Truth

Hermes recommends. The app persists.

Hermes should not:

- publish posts
- update draft statuses
- schedule content
- make platform API calls
- bypass human review

## Simulation

Development environments can call:

```http
POST /api/hermes/simulate
```

With:

```json
{ "runType": "morning_digest" }
```

The simulation payload is routed through the same import pipeline as real Hermes payloads.
