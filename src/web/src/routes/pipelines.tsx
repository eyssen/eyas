import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import PipelinesPage from '@/pages/pipelines/pipelines-page'

function PipelinesLayout() {
  // Check if we're on a child route (e.g. /pipelines/$runId)
  const childMatch = useMatch({ from: '/pipelines/$runId', shouldThrow: false })

  if (childMatch) {
    return <Outlet />
  }

  return (
    <AppLayout>
      <PipelinesPage />
    </AppLayout>
  )
}

export const Route = createFileRoute('/pipelines')({
  component: PipelinesLayout,
})
