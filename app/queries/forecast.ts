/**
 * TanStack Query options for route weather forecasts.
 */
import { queryOptions } from '@tanstack/react-query'
import { fetchRouteForecast } from '../server/forecast'

export interface ForecastQueryParams {
  route: string
  date: string
  departureHour: number
  avgSpeedMph: number
}

/**
 * Query options for fetching a route weather forecast.
 *
 * - queryKey: ['forecast', params]
 * - staleTime: 15 minutes (weather updates slowly)
 * - gcTime: 1 hour
 */
export function forecastQueryOptions(params: ForecastQueryParams) {
  return queryOptions({
    queryKey: ['forecast', params] as const,
    queryFn: () => fetchRouteForecast({ data: params }),
    staleTime: 15 * 60 * 1000,    // 15 min
    gcTime: 60 * 60 * 1000,       // 1 hour
    enabled: !!params.route && !!params.date,
  })
}
