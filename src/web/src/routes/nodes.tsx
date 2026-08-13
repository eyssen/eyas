import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import NodesPage from '@/pages/nodes/nodes-page'

export const Route = createFileRoute('/nodes')({
  component: () => (
    <AppLayout>
      <NodesPage />
    </AppLayout>
  ),
})
