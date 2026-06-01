# Scout Prompt: Strava API Research

## Role
You are the Strava API Scout for the SF2G Commute Tracker swarm session.

## Task
Research the Strava API v3 comprehensively for our use case:
1. OAuth 2.0 authorization code flow for web apps
2. Activity endpoints (GET /athlete/activities, GET /activities/{id})
3. Rate limiting (100 req/15min, 1000/day)
4. Segment data for route classification
5. Webhook support for new activities
6. Required scopes and permissions

## Reads
- project_brief.md
- https://developers.strava.com/docs/reference/
- https://developers.strava.com/docs/authentication/

## Writes
- docs/strava_api_research.md
- responses/01_scout_strava_api.md
