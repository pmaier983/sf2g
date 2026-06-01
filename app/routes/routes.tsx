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
      </div>

    </div>
  )
}
