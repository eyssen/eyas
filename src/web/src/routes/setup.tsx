import { createFileRoute } from '@tanstack/react-router'
import SetupPage from '@/pages/setup/setup-page'

export const Route = createFileRoute('/setup')({
  component: SetupPage,
})
