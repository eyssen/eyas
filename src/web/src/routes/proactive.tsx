import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ProactiveDashboard from '@/pages/proactive/proactive-dashboard'

export const Route = createFileRoute('/proactive')({
  component: () => (
    <AppLayout>
      <ProactiveDashboard />
    </AppLayout>
  ),
})
