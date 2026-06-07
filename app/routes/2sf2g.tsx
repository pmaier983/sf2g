import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/2sf2g')({
  beforeLoad: () => {
    throw redirect({ href: '/should-i-sf2g' })
  },
  component: () => null,
})
