import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import SourcesPage from '@/pages/search/sources-page'

export const Route = createFileRoute('/search-sources')({
  component: () => (
    <AppLayout>
      <SourcesPage />
    </AppLayout>
  ),
})
