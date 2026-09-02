import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ResearchPage from '@/pages/research/research-page'

export const Route = createFileRoute('/research')({
  component: () => (
    <AppLayout noPadding>
      <ResearchPage />
    </AppLayout>
  ),
})
