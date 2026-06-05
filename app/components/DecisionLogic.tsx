/**
 * DecisionLogic — Explains the Yes/Maybe/No scoring algorithm.
 *
 * Shows which factors contributed to the recommendation and the thresholds used.
 * Placed at the bottom of the forecast page for transparency.
 */
import type { ForecastResult } from '../server/forecast'
import { computeVerdict } from './RideRecommendation'

interface DecisionLogicProps {
  summary: ForecastResult['summary']
}

export function DecisionLogic({ summary }: DecisionLogicProps) {
  const verdict = computeVerdict(summary)

  return (
    <div className="decision-logic">
      <h3 className="decision-logic__title">📊 How We Decided</h3>
      <p className="decision-logic__intro">
        The recommendation starts at <strong>100 points</strong> and deducts
        for unfavorable conditions. Scores above 65 = YES, 35–65 = MAYBE,
        below 35 = NO.
      </p>

      {/* Factor breakdown */}
      <div className="decision-logic__factors">
        <h4 className="decision-logic__subtitle">Factors Applied</h4>
        {verdict.reasons.length > 0 ? (
          <ul className="decision-logic__list">
            {verdict.reasons.map((reason, i) => (
              <li key={i} className="decision-logic__item">
                {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="decision-logic__none">
            No significant factors — conditions look great!
          </p>
        )}
      </div>

      {/* Threshold reference */}
      <div className="decision-logic__thresholds">
        <h4 className="decision-logic__subtitle">Scoring Thresholds</h4>
        <table className="decision-logic__table">
          <thead>
            <tr>
              <th>Factor</th>
              <th>Concern</th>
              <th>Bad</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Rain probability</td>
              <td>&gt;30%</td>
              <td>&gt;60%</td>
            </tr>
            <tr>
              <td>Temperature</td>
              <td>&lt;45°F</td>
              <td>&lt;35°F</td>
            </tr>
            <tr>
              <td>Wind speed</td>
              <td>&gt;15 mph</td>
              <td>&gt;30 mph</td>
            </tr>
            <tr>
              <td>Headwind</td>
              <td>&gt;8 mph</td>
              <td>&gt;15 mph</td>
            </tr>
            <tr>
              <td>Fog probability</td>
              <td>&gt;20%</td>
              <td>&gt;50%</td>
            </tr>
            <tr>
              <td>Visibility</td>
              <td>&lt;5 km</td>
              <td>&lt;3 km</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="decision-logic__disclaimer">
        💡 This is an automated estimate based on Open-Meteo forecasts.
        Always use your own judgment — conditions can change quickly,
        especially on the coast and over Skyline.
      </p>
    </div>
  )
}
