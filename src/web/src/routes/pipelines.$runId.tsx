import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import TicketToCode from '@/pages/pipelines/TicketToCode'

export const Route = createFileRoute('/pipelines/$runId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { runId } = Route.useParams()
  return (
    <AppLayout>
      <TicketToCode runId={runId} />
    </AppLayout>
  )
}
