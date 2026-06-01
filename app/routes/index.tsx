import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({
      to: '/leaderboard',
      search: {
        routes: [],
        search: '',
        ppr: false,
        company: undefined,
        user: undefined,
        view: 'riders' as const,
        sort: 'sf2g_total',
        dir: 'desc' as const,
        rSort: 'ride_date',
        rDir: 'desc' as const,
        page: 1,
        dateFrom: undefined,
        dateTo: undefined,
        datePreset: undefined,
        density: 'expanded' as const,
      },
    })
  },
  component: () => null,
})
