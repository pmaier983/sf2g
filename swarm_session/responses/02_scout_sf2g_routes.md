# Scout Response: SF2G Routes Research

**Agent**: Scout #2 — SF2G Routes & Community
**Status**: ✅ COMPLETE

---

## Summary of Key Findings

### What is SF2G?
SF2G ("San Francisco to Google") is a grassroots bicycle commuting community of Bay Area tech workers who ride from San Francisco south to Peninsula workplaces (35-55 miles). The community features a Google Groups mailing list, Strava clubs (Egan Club ID: 469663), and the sf2g.com website with route maps.

### The Four Route Corridors
| Route | Path | Distance | Elevation | Character |
|-------|------|----------|-----------|-----------|
| **Bayway** | Bay Trail / eastern shore | ~35-40 mi | ~500-1,000 ft | Flat, fast, efficient |
| **Skyline** | Skyline Blvd / ridgeline | ~40-50 mi | ~3,000-5,000 ft | Hilly, challenging, scenic |
| **HMBW** | Highway 1 / coastal | ~45-55 mi | ~2,000-4,500 ft | Scenic, long, coastal |
| **Royale** | El Camino Real / urban | ~35-42 mi | ~500-1,200 ft | Urban, well-lit, direct |

## Proposed Route Classification Algorithm

### Three-Layer Classification (in priority order):

**Layer 1 — Strava Segment Matching** (highest confidence)
- Define 5-10 "signature" Strava segment IDs unique to each corridor
- If ≥2 segments match a single corridor → classify with high confidence

**Layer 2 — GPS Corridor / Bounding Box Matching**
- Decode `map.summary_polyline` and check corridor-specific bounding boxes

**Layer 3 — Elevation Heuristic** (tiebreaker)
- Skyline: >2,500 ft, Bayway: <1,000 ft + east, HMBW: 2,000-4,500 ft + coast, Royale: <1,200 ft + inland

## Open Questions About Route Detection

1. **🔴 Critical: Signature Strava Segment IDs** — Need to discover actual segment IDs for each corridor
2. **🟡 GPS Data Availability** — Is `summary_polyline` resolution sufficient for corridor matching?
3. **🟡 Return Trip Classification** — Should northbound rides be classified the same way?
4. **🟡 Partial Routes** — How to handle riders who only ride part of the route?
5. **🟡 Mixed Routes** — Some riders combine corridors
6. **🟢 Route Variations** — Classify at corridor level (4 categories) or also sub-variations?

## Full Research Document

See: `/Users/phillipmaier/Desktop/Code/sf2g/swarm_session/docs/sf2g_routes_research.md`
