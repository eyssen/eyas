import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/skill-evolution')({
  beforeLoad: () => {
    throw redirect({ to: '/forge' })
  },
})
