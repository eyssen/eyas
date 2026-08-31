import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ClientWikiPageView from '@/pages/client-wiki/ClientWiki'

export const Route = createFileRoute('/projects/$projectId/wiki')({
  component: RouteComponent,
})

function RouteComponent() {
  const { projectId } = Route.useParams()
  return (
    <AppLayout noPadding>
      <ClientWikiPageView clientId={projectId} />
    </AppLayout>
  )
}
