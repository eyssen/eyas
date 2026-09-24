import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ObservabilityPage from '@/pages/observability/observability-page'

export const Route = createFileRoute('/observability')({
  component: () => (
    <AppLayout>
      <ObservabilityPage />
    </AppLayout>
  ),
})
