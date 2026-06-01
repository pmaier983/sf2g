/**
 * Bay Area tech company office locations for destination classification.
 *
 * Each office has GPS coordinates used to detect if a ride ended near
 * a corporate campus. This powers the "SF2[Company]" leaderboard.
 *
 * Coordinates are approximate campus center-points. The destination
 * classifier uses an 800m radius to match ride endpoints.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DestinationCompany = 'netflix' | 'google' | 'apple' | 'meta' | 'nvidia' | 'stanford'

export interface OfficeLocation {
  company: DestinationCompany
  name: string
  lat: number
  lng: number
  city: string
  address: string
  status: 'active' | 'closed'
}

// ---------------------------------------------------------------------------
// Office Locations
// ---------------------------------------------------------------------------

export const OFFICE_LOCATIONS: OfficeLocation[] = [
  // =========================================================================
  // NETFLIX — Los Gatos
  // =========================================================================
  {
    company: 'netflix',
    name: 'Netflix HQ (Main Campus)',
    lat: 37.2560,
    lng: -121.9553,
    city: 'Los Gatos',
    address: '100 Winchester Circle',
    status: 'active',
  },
  {
    company: 'netflix',
    name: 'Netflix Albright Way',
    lat: 37.2530,
    lng: -121.9570,
    city: 'Los Gatos',
    address: '121 Albright Way',
    status: 'active',
  },
  {
    company: 'netflix',
    name: 'Netflix Epic Way',
    lat: 37.2512,
    lng: -121.9522,
    city: 'Los Gatos',
    address: '888 Epic Way',
    status: 'active',
  },
  {
    company: 'netflix',
    name: 'Netflix Winchester 250',
    lat: 37.2555,
    lng: -121.9530,
    city: 'Los Gatos',
    address: '250 Winchester Circle',
    status: 'active',
  },

  // =========================================================================
  // GOOGLE — Mountain View, Sunnyvale, San Francisco, San Jose
  // =========================================================================
  {
    company: 'google',
    name: 'Googleplex (HQ)',
    lat: 37.4220,
    lng: -122.0841,
    city: 'Mountain View',
    address: '1600 Amphitheatre Parkway',
    status: 'active',
  },
  {
    company: 'google',
    name: 'Google Bay View Campus',
    lat: 37.4135,
    lng: -122.0695,
    city: 'Mountain View',
    address: '1625 Plymouth Street',
    status: 'active',
  },
  {
    company: 'google',
    name: 'Google Charleston East',
    lat: 37.4145,
    lng: -122.0775,
    city: 'Mountain View',
    address: '2000 N Shoreline Blvd',
    status: 'active',
  },
  {
    company: 'google',
    name: 'Google Sunnyvale (Moffett Park)',
    lat: 37.4078,
    lng: -122.0310,
    city: 'Sunnyvale',
    address: '803 11th Avenue',
    status: 'active',
  },

  {
    company: 'google',
    name: 'Google San Jose',
    lat: 37.3340,
    lng: -121.8940,
    city: 'San Jose',
    address: '500 W San Fernando St',
    status: 'active',
  },

  // =========================================================================
  // APPLE — Cupertino, Sunnyvale, Santa Clara, San Jose
  // =========================================================================
  {
    company: 'apple',
    name: 'Apple Park (HQ)',
    lat: 37.3349,
    lng: -122.0090,
    city: 'Cupertino',
    address: '1 Apple Park Way',
    status: 'active',
  },
  {
    company: 'apple',
    name: 'Infinite Loop (Old HQ)',
    lat: 37.3318,
    lng: -122.0312,
    city: 'Cupertino',
    address: '1 Infinite Loop',
    status: 'active',
  },
  {
    company: 'apple',
    name: 'Apple De Anza Campus',
    lat: 37.3358,
    lng: -122.0275,
    city: 'Cupertino',
    address: '10500 N De Anza Blvd',
    status: 'active',
  },
  {
    company: 'apple',
    name: 'Apple Sunnyvale Campus',
    lat: 37.3690,
    lng: -122.0300,
    city: 'Sunnyvale',
    address: '100 S Mathilda Ave',
    status: 'active',
  },
  {
    company: 'apple',
    name: 'Apple Santa Clara',
    lat: 37.3230,
    lng: -121.9950,
    city: 'Santa Clara',
    address: '5300 Stevens Creek Blvd',
    status: 'active',
  },
  {
    company: 'apple',
    name: 'Apple San Jose (North)',
    lat: 37.3750,
    lng: -121.9150,
    city: 'San Jose',
    address: 'Orchard Parkway area',
    status: 'active',
  },

  // =========================================================================
  // META / FACEBOOK — Menlo Park, Burlingame, Sunnyvale
  // =========================================================================
  {
    company: 'meta',
    name: 'Meta MPK HQ',
    lat: 37.4848,
    lng: -122.1484,
    city: 'Menlo Park',
    address: '1 Hacker Way',
    status: 'active',
  },
  {
    company: 'meta',
    name: 'Meta MPK West Campus',
    lat: 37.4815,
    lng: -122.1540,
    city: 'Menlo Park',
    address: '1 Facebook Way',
    status: 'active',
  },
  {
    company: 'meta',
    name: 'Meta Burlingame Campus',
    lat: 37.5920,
    lng: -122.3640,
    city: 'Burlingame',
    address: '300 Airport Blvd',
    status: 'active',
  },

  {
    company: 'meta',
    name: 'Meta Sunnyvale Campus',
    lat: 37.4095,
    lng: -122.0245,
    city: 'Sunnyvale',
    address: '1020 Enterprise Way',
    status: 'active',
  },

  // =========================================================================
  // NVIDIA — Santa Clara
  // =========================================================================
  {
    company: 'nvidia',
    name: 'Nvidia Endeavor (HQ)',
    lat: 37.3705,
    lng: -121.9638,
    city: 'Santa Clara',
    address: '2788 San Tomas Expressway',
    status: 'active',
  },
  {
    company: 'nvidia',
    name: 'Nvidia Voyager',
    lat: 37.3835,
    lng: -121.9680,
    city: 'Santa Clara',
    address: '3200 Bowers Avenue',
    status: 'active',
  },
  {
    company: 'nvidia',
    name: 'Nvidia Building E (Old HQ)',
    lat: 37.3690,
    lng: -121.9640,
    city: 'Santa Clara',
    address: '2701 San Tomas Expressway',
    status: 'active',
  },
  {
    company: 'nvidia',
    name: 'Nvidia Scott Blvd Campus',
    lat: 37.3720,
    lng: -121.9580,
    city: 'Santa Clara',
    address: '2800 Scott Boulevard',
    status: 'active',
  },

  // =========================================================================
  // STANFORD — Stanford University
  // =========================================================================
  {
    company: 'stanford',
    name: 'Stanford University (Main Campus)',
    lat: 37.425744,
    lng: -122.167450,
    city: 'Stanford',
    address: 'Stanford University',
    status: 'active',
  },
]

// ---------------------------------------------------------------------------
// Display Metadata
// ---------------------------------------------------------------------------

export const COMPANY_LABELS: Record<DestinationCompany, string> = {
  netflix: 'Netflix',
  google: 'Google',
  apple: 'Apple',
  meta: 'Meta',
  nvidia: 'Nvidia',
  stanford: 'Stanford',
}

export const COMPANY_COLORS: Record<DestinationCompany, string> = {
  netflix: '#E50914',  // Netflix red
  google: '#FBBC05',   // Google yellow
  apple: '#A2AAAD',    // Apple silver
  meta: '#0668E1',     // Meta blue
  nvidia: '#76B900',   // Nvidia green
  stanford: '#8C1515',  // Stanford cardinal red
}

/**
 * Radius in meters for destination matching.
 * A ride endpoint must be within this distance of an office to count.
 *
 * 800m (~2600ft / ~0.5mi) provides a generous capture area around campus endpoints.
 */
export const DESTINATION_RADIUS_METERS = 800
