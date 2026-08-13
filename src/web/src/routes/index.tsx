import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import DashboardPage from '@/pages/dashboard/dashboard-page'

export const Route = createFileRoute('/')({
  component: () => (
    <AppLayout>
      <DashboardPage />
    </AppLayout>
  ),
})
