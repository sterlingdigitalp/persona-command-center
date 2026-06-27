# X API Readiness Report

Status: pre-credential ready

Persona Command Center can now run the account-management workflow locally without X credentials:

```text
signal -> draft -> review -> schedule -> manual publish -> performance capture -> memory/history
```

The app still does not call X, does not publish externally, and does not require X environment variables.

## Already Complete

- Persona configuration stores X handles and platform status locally.
- RSS/news and Hermes ingestion produce reviewed signals without X recent search.
- Signals support review and dismissal reasons.
- Drafts support approval and rejection reasons.
- Draft responses include local X quality checks for character count, empty text, links, hashtag volume, and high-claim terms.
- Scheduled posts prepare X copy without publishing externally.
- Scheduled posts can be manually marked as published after an operator posts outside the app.
- Published posts are stored in a local `published_posts` ledger.
- Manual performance capture stores impressions, likes, reposts, replies, bookmarks, notes, and update timestamp.
- Operator queue connects personas, signals, velocity alerts, drafts, scheduled posts, and published outcomes.
- Signal history remains available through snapshots, and used signals retain `used_at`.
- Verification covers the full local operator loop through `npm run verify:phase5`.

## Still Manual

- X login and posting happen outside Persona Command Center.
- Published URLs and post IDs are entered manually.
- Performance metrics are copied manually from the X UI.
- Search discovery uses RSS/news/Hermes provider paths, not X recent search.
- Media upload and media validation are local metadata only.
- Rate limits, token refresh, and X account health are not active because credentials are not connected.

## Environment Variables Required Later

Do not set these for Phase 5. They are listed for the future X integration phase:

- `X_API_KEY`
- `X_API_KEY_SECRET`
- `X_CLIENT_ID`
- `X_CLIENT_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`
- `X_REFRESH_TOKEN`
- `X_REDIRECT_URI`
- `X_WEBHOOK_SECRET`
- `X_APP_ENV`

Exact names may be adjusted during adapter implementation, but the integration should keep credentials out of SQLite and avoid logging secrets.

## Permissions And Scopes Required Later

Future X integration will need only the minimum scopes for the enabled features:

- Read account/user identity.
- Read posts/tweets for published-post lookup and metrics.
- Write posts/tweets for publishing after operator approval.
- Offline access or token refresh if OAuth 2.0 refresh is used.
- Media upload permission if image/video posting is added.

Do not request direct-message, ad account, or unrelated elevated permissions for the first integration.

## Integration Sequence Once Credentials Exist

1. Add a credential/config validation endpoint that confirms required environment variables exist without printing values.
2. Add an X client module with rate-limit-aware request handling and redacted logging.
3. Add a read-only account health check for configured persona handles.
4. Add a recent-search provider behind the existing ingestion provider abstraction.
5. Add metric refresh for `published_posts` using stored external post IDs.
6. Add a dry-run publishing adapter that validates payloads and records what would be sent.
7. Add real publishing only for scheduled posts that have passed quality checks and operator approval.
8. Store returned external post ID, published URL, platform response metadata, and publish failure details.
9. Add retry/failure states and verification scripts for credential validation, dry-run publishing, and metric refresh.
10. Keep manual mark-as-published as a fallback path.

## Remaining Risks Before Real X Integration

- Secret storage and OAuth/token refresh are not implemented.
- There is no platform rate-limit budget or retry strategy yet.
- Draft quality checks are useful but not a substitute for legal/editorial approval.
- Media upload behavior and media constraints are not implemented.
- The current UI may need additional controls for credential health, publish failures, and metric refresh once X is connected.
