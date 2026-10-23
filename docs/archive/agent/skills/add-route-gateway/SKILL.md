---
name: add-route-gateway
description: "Add or modify route gateway checkpoints for the route classification system. Use this skill when the user wants to add a new gateway checkpoint, modify existing gateway coordinates, add a new route category, or adjust the classification parameters. Also use when the user mentions 'gateway', 'checkpoint', 'route classification', 'classify rides', or wants to change how rides are categorized."
---

# Add Route Gateway

Add or modify GPS gateway checkpoints used by the route classification system.

## Overview

SF2G classifies rides into route corridors (Bayway, Skyline, HMBW, Royale) by checking if the ride's GPS polyline passes within 500m of known gateway checkpoints. This skill walks through adding or modifying those gateways.

## Before You Start

Read these files to understand the current system:

1. `app/lib/constants.ts` — Contains `ROUTE_GATEWAYS` array and `GATEWAY_RADIUS_METERS`
2. `app/lib/route-classifier.ts` — The classification logic
3. `app/lib/destination-classifier.ts` — Destination (office) classification
4. `app/lib/office-locations.ts` — Corporate office GPS coordinates

## Adding a New Gateway

### Step 1: Identify the location

Get the GPS coordinates (lat, lng) for the gateway checkpoint. Use Google Maps or the InteractiveMap component in dev mode to pinpoint the exact location.

### Step 2: Add to constants

Add the gateway to the `ROUTE_GATEWAYS` array in `app/lib/constants.ts`:

```typescript
{
  name: 'descriptive-name',
  lat: 37.XXXXX,
  lng: -122.XXXXX,
  category: 'bayway' | 'skyline' | 'hmbw' | 'royale',
}
```

### Step 3: Verify classification

Use the DevToolsPanel (`app/components/DevToolsPanel.tsx`) to test:

1. Start the dev server: `pnpm dev`
2. Navigate to the dev tools panel
3. Run reclassification on existing rides to verify the new gateway doesn't cause regressions

### Step 4: Consider edge cases

- Does the new gateway overlap with another route's gateways?
- Could the gateway incorrectly classify non-commute rides (recreational rides near the checkpoint)?
- Is the gateway specific enough, or too generic (e.g., near a major intersection shared by multiple routes)?

## Adding a New Office Location

For destination classification (which company the rider is commuting to):

### Step 1: Add to office-locations.ts

Add the office to `app/lib/office-locations.ts`:

```typescript
{
  company: 'Company Name',
  office: 'Office Campus Name',
  lat: 37.XXXXX,
  lng: -122.XXXXX,
  active: true, // false for closed offices
}
```

### Step 2: Verify proximity threshold

The destination classifier uses a 200m radius. Ensure the coordinates are precise enough that the office doesn't overlap with nearby offices from other companies.

## Modifying Classification Parameters

- `GATEWAY_RADIUS_METERS` (default: 500) — How close a polyline point must be to a gateway
- `MIN_DISTANCE_METERS` (default: 40,000) — Minimum ride distance for elevation fallback
- Elevation thresholds in `classifyByElevation()` — Adjust for route-specific elevation profiles

## After Making Changes

1. Run `pnpm typecheck` to verify types
2. Run `pnpm test` if tests exist for the classifier
3. Use the reclassify endpoint to verify changes against existing data
4. Commit with: `feat: add <gateway-name> gateway for <route> classification`
