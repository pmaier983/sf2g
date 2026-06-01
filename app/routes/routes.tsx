import { createFileRoute } from '@tanstack/react-router'
import { InteractiveMaps } from '../components/InteractiveMap'
import '../styles/routes.css'
import '../styles/maps.css'

export const Route = createFileRoute('/routes')({
  component: RoutesPage,
  head: () => ({
    meta: [
      { title: 'SF2G Routes — Route Corridors, Gateways & Maps' },
      {
        name: 'description',
        content:
          'Explore SF2G route corridors, GPS gateway checkpoints, company office locations, and the commute zone classification logic — all on interactive maps.',
      },
    ],
  }),
})



function RoutesPage() {
  return (
    <div className="routes-page">
      <div className="container">
        {/* Header */}
        <div className="routes-page__header animate-fade-in">
          <h1 className="routes-page__title">SF2G Route Corridors</h1>
        </div>



        {/* Interactive Maps */}
        <InteractiveMaps />

        {/* Wind Factor Explanation */}
        <section className="wind-explainer animate-fade-in">
          <h2 className="wind-explainer__title">💨 How Wind Factor Is Calculated</h2>
          <p className="wind-explainer__intro">
            Every SF2G ride is enriched with historical wind data so you can see how much
            Mother Nature helped — or hurt — your commute. Here's how it works:
          </p>

          <div className="wind-explainer__steps">
            <div className="wind-explainer__step">
              <span className="wind-explainer__step-number">1</span>
              <div>
                <h3 className="wind-explainer__step-title">Fetch Historical Wind</h3>
                <p className="wind-explainer__step-desc">
                  We pull hourly wind speed, direction, and gust data from the{' '}
                  <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
                    Open-Meteo Archive API
                  </a>{' '}
                  using your ride's start coordinates and date. Wind is sampled at the hour
                  your ride began (Pacific time).
                </p>
              </div>
            </div>

            <div className="wind-explainer__step">
              <span className="wind-explainer__step-number">2</span>
              <div>
                <h3 className="wind-explainer__step-title">Calculate Ride Bearing</h3>
                <p className="wind-explainer__step-desc">
                  Your ride's direction of travel is computed from the start and end GPS
                  coordinates using the{' '}
                  <strong>Haversine bearing formula</strong>. This gives a compass heading
                  (0° = north, 90° = east, etc.) representing the overall direction you rode.
                </p>
              </div>
            </div>

            <div className="wind-explainer__step">
              <span className="wind-explainer__step-number">3</span>
              <div>
                <h3 className="wind-explainer__step-title">Project Wind onto Ride Direction</h3>
                <p className="wind-explainer__step-desc">
                  Wind direction is reported as where wind blows <em>from</em> (meteorological
                  convention). We flip it 180° to get the direction wind is going <em>to</em>,
                  then use <strong>cosine projection</strong> to decompose it into:
                </p>
                <ul className="wind-explainer__formula-list">
                  <li>
                    <strong>Tailwind component</strong> = wind speed × cos(wind_to − ride_bearing)
                  </li>
                  <li>
                    <strong>Crosswind component</strong> = wind speed × sin(wind_to − ride_bearing)
                  </li>
                </ul>
                <p className="wind-explainer__step-desc">
                  A positive tailwind means the wind was pushing you forward; negative means
                  you were riding into a headwind.
                </p>
              </div>
            </div>

            <div className="wind-explainer__step">
              <span className="wind-explainer__step-number">4</span>
              <div>
                <h3 className="wind-explainer__step-title">Classify & Display</h3>
                <p className="wind-explainer__step-desc">
                  The tailwind value (in m/s, displayed as mph) is classified for color-coding:
                </p>
                <div className="wind-explainer__thresholds">
                  <div className="wind-explainer__threshold">
                    <span className="wind-explainer__threshold-dot" style={{ background: 'var(--color-success)' }} />
                    <span><strong>Strong tailwind</strong> — {'>'} 6.7 mph (3 m/s)</span>
                  </div>
                  <div className="wind-explainer__threshold">
                    <span className="wind-explainer__threshold-dot" style={{ background: 'var(--color-success)', opacity: 0.6 }} />
                    <span><strong>Light tailwind</strong> — 2.2–6.7 mph (1–3 m/s)</span>
                  </div>
                  <div className="wind-explainer__threshold">
                    <span className="wind-explainer__threshold-dot" style={{ background: 'var(--color-text-muted)' }} />
                    <span><strong>Calm</strong> — {'<'} 2.2 mph ({'<'} 1 m/s either way)</span>
                  </div>
                  <div className="wind-explainer__threshold">
                    <span className="wind-explainer__threshold-dot" style={{ background: 'var(--color-error)', opacity: 0.6 }} />
                    <span><strong>Light headwind</strong> — 2.2–6.7 mph (1–3 m/s)</span>
                  </div>
                  <div className="wind-explainer__threshold">
                    <span className="wind-explainer__threshold-dot" style={{ background: 'var(--color-error)' }} />
                    <span><strong>Strong headwind</strong> — {'>'} 6.7 mph (3 m/s)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p className="wind-explainer__note">
            On the leaderboard, each rider's <strong>Avg Wind</strong> column shows the mean
            tailwind across all their SF2G rides. Individual ride wind values are visible on
            profile pages.
          </p>
        </section>
      </div>

    </div>
  )
}
