import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ConnectionsPage from '@/pages/connections/connections-page'

export const Route = createFileRoute('/connections')({
  component: () => (
    <AppLayout>
      <ConnectionsPage />
    </AppLayout>
  ),
})
