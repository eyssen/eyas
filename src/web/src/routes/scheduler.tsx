import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import SchedulerPage from '@/pages/scheduler/scheduler-page'

export const Route = createFileRoute('/scheduler')({
  component: () => (
    <AppLayout>
      <SchedulerPage />
    </AppLayout>
  ),
})
