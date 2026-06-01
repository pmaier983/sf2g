# SF2G Routes — Comprehensive Research

## 1. What is SF2G?

### Overview
SF2G stands for **"San Francisco to Google"** — though in practice it encompasses any bicycle commute from San Francisco southward down the Peninsula to workplaces in cities like Daly City, South San Francisco, San Mateo, Redwood City, Palo Alto, Mountain View, and Sunnyvale. The name originally referenced Google's Mountain View campus as the primary destination, but the community includes riders commuting to any Peninsula employer.

### Community & Culture
- **Origins**: SF2G grew organically from Bay Area tech workers who discovered they could bike-commute the ~35-50 mile distance from San Francisco to Peninsula offices. The community coalesced around a Google Groups mailing list (`groups.google.com/g/sf2g`) where riders coordinate meetups, share route info, and discuss conditions.
- **The Egan Ride**: "Egan" is the most well-known organized group ride within SF2G. It has its own Strava club (Club ID: **469663**). Egan rides are tracked via a Strava scraper system that records segment efforts and displays results on a Route Viewer web app.
- **Culture**: Grassroots, tech-savvy riders — many are software engineers who build tools around their rides. Competitive but welcoming. Route variety based on mood, fitness, weather, and time constraints. Year-round commuting. Safety-conscious.
- **Online Presence**: 
  - Official website: **sf2g.com** — static site with route maps and descriptions
  - Google Groups mailing list for coordination
  - Strava clubs for tracking rides
  - Route Viewer app (`route-viewer.vercel.app`) for Egan ride results

---

## 2. Route Corridors

All four routes share a common characteristic: they start somewhere in San Francisco and end somewhere on the Peninsula south of SF. The routes diverge primarily in **which north-south corridor** they follow.

### Geographic Context
- **Start Zone**: San Francisco — riders typically depart from neighborhoods like the Mission, SoMa, Potrero Hill, Bernal Heights, or the Sunset/Richmond
- **End Zone**: Peninsula — Palo Alto, Mountain View, Sunnyvale
- **Total distance**: ~35-55 miles depending on route and exact start/end points

---

### 2.1 Bayway (https://sf2g.com/bayway.html)

**The Bay Trail / Eastern Shore Route**

#### Description
The Bayway follows the eastern side of the Peninsula, roughly paralleling US-101 and the San Francisco Bay shoreline. It's the **flattest and most direct** route.

#### Key Road Segments & Landmarks
1. **SF Exit**: Cesar Chavez St → 3rd Street / Evans Ave → Bayshore Blvd
2. **Brisbane/SSF**: Bayshore Blvd through Brisbane, South San Francisco
3. **SFO Area**: Bay Trail past SFO airport, through Millbrae/Burlingame shoreline
4. **Foster City/San Mateo**: Bay Trail through Foster City levee paths
5. **Redwood City**: Bay Trail/Bayfront paths through Redwood Shores
6. **Palo Alto/Mountain View**: Bay Trail along Palo Alto Baylands → Shoreline Park

#### Typical Stats
- **Distance**: ~35-40 miles
- **Elevation Gain**: ~500-1,000 ft (minimal)
- **Character**: Fast, flat, efficient. Mix of bike paths and urban roads
- **Best For**: Speed, time-efficiency, beginners

#### Distinctive Waypoints
- Bayshore Blvd corridor (lat ~37.70, lng ~-122.40)
- Bay Trail near SFO (lat ~37.62, lng ~-122.38)
- Foster City Levee (lat ~37.56, lng ~-122.27)
- Palo Alto Baylands (lat ~37.45, lng ~-122.11)

---

### 2.2 Skyline (https://sf2g.com/skyline.html)

**The Ridge Route / Mountain Corridor**

#### Description
The Skyline route traverses the **spine of the Santa Cruz Mountains** via Skyline Boulevard (CA Route 35). The **hilliest and most challenging** route.

#### Key Road Segments & Landmarks
1. **SF Exit**: Via Sunset District → Skyline Blvd heading south
2. **Sharp Park / Skyline Entry**: Climb from sea level to ridgeline (~1,000-1,500 ft)
3. **Skyline Blvd (CA-35)**: Main spine road along the crest
4. **Key Climbs**: Multiple rollers, some sections above 2,000 ft
5. **Descent Options**: Kings Mountain Road, Page Mill Road, Old La Honda Road

#### Typical Stats
- **Distance**: ~40-50 miles
- **Elevation Gain**: ~3,000-5,000 ft (significant)
- **Character**: Challenging, scenic, mountainous
- **Best For**: Strong climbers, training rides

#### Distinctive Waypoints
- Skyline Blvd near Daly City (lat ~37.68, lng ~-122.47)
- Skyline Blvd at Kings Mountain (lat ~37.45, lng ~-122.34)
- Page Mill / Skyline intersection (lat ~37.39, lng ~-122.20)

---

### 2.3 Half Moon Bay Way / HMBW (https://sf2g.com/hmbw.html)

**The Coastal Highway 1 Route**

#### Description
The HMBW follows the **Pacific coast** via Highway 1. The **most scenic and longest** route, with dramatic ocean cliffs and Devil's Slide.

#### Key Road Segments & Landmarks
1. **SF Exit**: Via Great Highway / Skyline Blvd → Sharp Park Road → Pacifica
2. **Pacifica**: Highway 1 through Pacifica along the coast
3. **Devil's Slide**: Famous tunnel/trail section
4. **Montara / Moss Beach**: Coastal riding along bluffs
5. **Half Moon Bay**: Through the town on Highway 1
6. **Inland Crossing**: Cut east via Highway 92, Tunitas Creek Road, or Stage Road

#### Typical Stats
- **Distance**: ~45-55+ miles
- **Elevation Gain**: ~2,000-4,500 ft
- **Character**: Scenic, adventurous, exposed to coastal wind
- **Best For**: Scenery, adventure, longer rides

#### Distinctive Waypoints
- Pacifica / Sharp Park (lat ~37.63, lng ~-122.49)
- Devil's Slide / Tom Lantos Tunnels (lat ~37.57, lng ~-122.52)
- Half Moon Bay downtown (lat ~37.46, lng ~-122.43)

---

### 2.4 El Camino Real / Royale (https://sf2g.com/royale.html)

**The Urban Boulevard Route**

#### Description
The Royale follows **El Camino Real** (CA Route 82), the historic main road through every Peninsula city. Flat, well-lit, urban.

#### Key Road Segments & Landmarks
1. **SF Exit**: Mission St / Cesar Chavez → Geneva Ave → Daly City
2. **Daly City → Mountain View**: El Camino Real through every Peninsula city center

#### Typical Stats
- **Distance**: ~35-42 miles
- **Elevation Gain**: ~500-1,200 ft
- **Character**: Urban, well-lit, most stop lights
- **Best For**: Night riding, bad weather, direct commuting

#### Distinctive Waypoints
- El Camino Real in Daly City (lat ~37.69, lng ~-122.47)
- El Camino Real in San Mateo (lat ~37.56, lng ~-122.32)
- El Camino Real at Stanford/Palo Alto (lat ~37.44, lng ~-122.16)

---

## 3. Route Classification Logic

### 3.1 Recommended Combined Algorithm

**Layer 1 — Strava Segment Matching** (highest confidence)
- Define 5-10 "signature" Strava segment IDs unique to each corridor
- Match activity's `segment_efforts` against signature segments
- If ≥2 segments match a single corridor → classify with high confidence

**Layer 2 — GPS Corridor / Bounding Box Matching**
- Decode activity's `map.summary_polyline` into lat/lng points
- Check if track passes through corridor-specific bounding boxes

**Layer 3 — Elevation Heuristic** (tiebreaker)
- Skyline: >2,500 ft gain
- Bayway: <1,000 ft gain + eastern longitude
- HMBW: 2,000-4,500 ft + coastal waypoint
- Royale: <1,200 ft + inland longitude

### Key Insight
The most reliable single discriminator is the geographic corridor:
- **Coastal (west of ridgeline)** = HMBW
- **Ridgeline (high elevation)** = Skyline
- **Bay shore (east)** = Bayway
- **Valley floor (middle, urban)** = Royale

---

## 4. Community Info

### Known Strava IDs
- **Egan Club ID**: 469663
- **Sample Segment IDs** (from Egan Scraper docs): 913443, 631065, 15025857, 21192549, 2190242, 2903975, 7994833, 640149, 6664213, 711223, 617901, 1631602, 7563239

### Edge Cases
1. **Mixed routes**: Rider takes Skyline but descends to Bay Trail for final portion
2. **Short rides**: Only part of the commute
3. **Return trips**: Northbound (same corridor classification should apply)
4. **Non-commute rides**: Weekend rides on commute routes
