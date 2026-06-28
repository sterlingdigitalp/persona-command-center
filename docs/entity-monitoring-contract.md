# Entity Monitoring Contract

## Purpose
Define the contract between tracked entities and the Persona Command Center's monitoring infrastructure. This document specifies how entities are discovered, subscribed to by personas, and how each monitor channel operates.

## Data Model

### `tracked_entities` — Master Entity Registry
| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT (UUID) | Primary key, e.g. `ent-karpathy` |
| `name` | TEXT | Display name (e.g. "Andrej Karpathy") |
| `type` | TEXT | `person`, `organization`, `project` |
| `primary_x_handle` | TEXT | Primary X/Twitter handle (with @) |
| `aliases_json` | TEXT | JSON array of alternate names/handles |
| `github_urls_json` | TEXT | JSON array of GitHub profile/repo URLs |
| `website_urls_json` | TEXT | JSON array of website URLs |
| `rss_urls_json` | TEXT | JSON array of RSS feed URLs |
| `keywords_json` | TEXT | JSON array of search keywords |
| `notes` | TEXT | Free-text notes |
| `is_active` | INTEGER | 1 = active, 0 = inactive |
| `created_at` / `updated_at` | TEXT | Timestamps |

### `persona_entity_subscriptions` — Per-Persona Monitor Config
| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT (UUID) | Primary key |
| `persona_id` | TEXT | FK to `personas.id` |
| `entity_id` | TEXT | FK to `tracked_entities.id` |
| `priority` | INTEGER | 1–10 priority for this subscription |
| `is_active` | INTEGER | 1 = active, 0 = paused |
| `monitor_x` | INTEGER | 1 = monitor X/Twitter posts |
| `monitor_mentions` | INTEGER | 1 = monitor X/Twitter mentions |
| `monitor_rss` | INTEGER | 1 = monitor RSS feeds |
| `monitor_crawl4ai` | INTEGER | 1 = monitor via Crawl4AI |
| `monitor_searchagent` | INTEGER | 1 = monitor via SearchAgent |

## Monitor Channels

### X/Twitter (`monitor_x`)
- Subscribes to the entity's `primary_x_handle` via the X provider
- Polls for new tweets at the configured Velocity interval

### X Mentions (`monitor_mentions`)
- Searches for mentions of the entity's `primary_x_handle` and `aliases_json`
- Uses the X search endpoint

### RSS (`monitor_rss`)
- Monitors RSS feeds listed in `rss_urls_json`
- Falls back to keyword-based RSS search using `keywords_json`

### Crawl4AI (`monitor_crawl4ai`)
- Targets URLs in `website_urls_json`, `github_urls_json`, or persona crawl targets
- Uses the Crawl4AI provider for deeper web scraping

### SearchAgent (`monitor_searchagent`)
- Triggers SearchAgent queries for entities with this flag enabled
- Uses `keywords_json` and `name` as query seeds

## Lifecycle

1. Entity is created via `POST /api/entities` (admin-only in UI, API-accessible)
2. Persona subscribes via `POST /api/personas/{id}/entities`
3. Monitor channels are enabled/disabled via `PATCH /api/personas/{id}/entities/{subId}`
4. Subscription is removed via `DELETE /api/personas/{id}/entities/{subId}`
5. Entity is deactivated via `PATCH /api/entities/{entityId}` with `{ "is_active": 0 }`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/entities` | List all tracked entities |
| POST | `/api/entities` | Create a tracked entity |
| PATCH | `/api/entities/:id` | Update a tracked entity |
| DELETE | `/api/entities/:id` | Delete a tracked entity |
| POST | `/api/personas/:id/entities` | Subscribe persona to entity |
| PATCH | `/api/personas/:id/entities/:subId` | Update subscription config |
| DELETE | `/api/personas/:id/entities/:subId` | Unsubscribe persona from entity |
| GET | `/api/personas` | Returns subscriptions inline per persona |
| GET | `/api/hermes/export` | Returns subscriptions + tracked entities for Hermes |

## Seed Protection
- Seed entities use `ON CONFLICT(id) DO NOTHING`
- User modifications to subscriptions are not overwritten by re-seeding
- `locked_from_seed_overwrite` flag may be added in future to protect user edits
