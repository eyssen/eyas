import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import MemoryDashboard from '@/pages/memory/memory-dashboard'

export const Route = createFileRoute('/memory')({
  component: () => (
    <AppLayout>
      <MemoryDashboard />
    </AppLayout>
  ),
})
