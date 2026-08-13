import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import SecurityEventsPage from '@/pages/security/security-events-page'

export const Route = createFileRoute('/security')({
  component: () => (
    <AppLayout>
      <SecurityEventsPage />
    </AppLayout>
  ),
})
