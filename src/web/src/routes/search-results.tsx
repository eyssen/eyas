import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import SearchResultsPage from '@/pages/search/search-results-page'

export const Route = createFileRoute('/search-results')({
  component: () => (
    <AppLayout noPadding>
      <SearchResultsPage />
    </AppLayout>
  ),
})
