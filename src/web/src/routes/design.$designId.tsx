import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import DesignDetailPage from '@/pages/design/design-detail-page'

function DesignDetailRoute() {
  const { designId } = Route.useParams()
  // noPadding: the canvas is full-bleed and manages its own scroll/pan surface.
  return (
    <AppLayout noPadding>
      <DesignDetailPage designId={designId} />
    </AppLayout>
  )
}

export const Route = createFileRoute('/design/$designId')({
  component: DesignDetailRoute,
})
