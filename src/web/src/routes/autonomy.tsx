import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import AutonomyDashboard from '@/pages/autonomy/autonomy-dashboard'

export const Route = createFileRoute('/autonomy')({
  component: () => (
    <AppLayout>
      <AutonomyDashboard />
    </AppLayout>
  ),
})
