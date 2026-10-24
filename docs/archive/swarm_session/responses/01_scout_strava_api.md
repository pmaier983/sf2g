# Scout Report: Strava API v3 Research

**Agent:** Scout (Strava API Research)
**Status:** ✅ Complete
**Date:** 2026-05-25

## Summary of Key Findings

### OAuth 2.0
- Standard Authorization Code Grant flow with 3 endpoints: `/oauth/authorize`, `/oauth/token` (exchange + refresh), `/oauth/deauthorize`
- Access tokens expire every **6 hours**. Refresh tokens may rotate on each refresh — always store the latest.
- Token exchange response includes an **athlete profile object** — free user data without an extra API call.

### Activity Endpoints
- `GET /athlete/activities` returns **Summary Activity** objects with pagination (`per_page` max 200)
- `after` parameter (epoch timestamp) enables efficient **incremental sync**
- Summary includes `map.summary_polyline` (encoded GPS trace) — potentially sufficient for route classification without fetching full details
- `GET /activities/{id}` returns **Detailed Activity** with `segment_efforts` array — the key to segment-based route classification
- `include_all_efforts=true` parameter needed to get ALL segment matches

### Rate Limiting
- **200 requests / 15 minutes** and **2,000 requests / day** (application-level, shared across all users)
- Note: Project brief says 100/15min — this appears outdated. Current docs say 200/15min.
- Headers `X-RateLimit-Limit` and `X-RateLimit-Usage` included in every response
- 429 on exceeded — implement exponential backoff + proactive throttling

### Segment Data & Route Classification
- Detailed activities include `segment_efforts` with full segment metadata (ID, name, location, grade, etc.)
- **Hybrid classification recommended:** Segment ID matching (primary) + polyline geo-matching (fallback)
- `GET /segments/explore` can discover segments within geographic bounds — useful for building our corridor mapping
- The existing Egan Scraper already uses segment IDs for similar purposes

### Webhooks
- **Yes, Strava supports webhooks!** Highly recommended over polling.
- Event types: `create`, `update`, `delete` for activities and athletes
- Webhook payload contains only IDs — must call API for actual data
- Limit: **1 subscription per application**
- Requires HTTPS callback URL — could use Supabase Edge Function

### Scopes
- **Recommended scopes:** `read,activity:read_all`
- `activity:read_all` is essential — many commuters mark rides as private
- Without it, we'd miss private activities entirely

## Open Questions & Concerns

1. **Segment ID Curation:** Who will identify and curate the specific Strava segment IDs for each SF2G corridor? This is a one-time but critical manual task.
2. **Rate Limit Budget with Multiple Users:** With 2,000 API calls/day shared across ALL users, initial sync for a new user with 500+ rides would consume 25%+ of the daily budget.
3. **Webhook Receiver Infrastructure:** Where does the webhook callback live? Supabase Edge Function recommended.
4. **Rate Limit Numbers Discrepancy:** Project brief says 100 req/15min. Strava docs now say 200 req/15min.
5. **Subscription Limit:** Only 1 webhook subscription per app means no separate dev/staging/prod subscriptions.
6. **Token Storage Security:** Refresh tokens are long-lived credentials. Need encryption at rest.

## Recommendations for Next Steps

1. **Register a Strava API application** to confirm actual rate limits and get Client ID/Secret.
2. **Build the OAuth flow first** — it gates everything else.
3. **Use webhooks for sync, not polling** — much more efficient and near-real-time.
4. **Design a rate-limit-aware job queue** for initial syncs and batch processing.
5. **Start curating SF2G corridor segment IDs** — check sf2g.com and Egan Scraper references.
6. **Use `summary_polyline` from activity list as first-pass route classifier** to minimize API calls.

## Full Research Document

See: `/Users/phillipmaier/Desktop/Code/sf2g/swarm_session/docs/strava_api_research.md`
