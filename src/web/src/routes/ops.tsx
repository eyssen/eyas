import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import OpsPage from '@/pages/ops/ops-page'

export const Route = createFileRoute('/ops')({
  component: () => (
    <AppLayout>
      <OpsPage />
    </AppLayout>
  ),
})
