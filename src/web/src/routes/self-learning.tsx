import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import InsightsPage from '@/pages/self-learning/insights-page'

export const Route = createFileRoute('/self-learning')({
  component: () => (
    <AppLayout>
      <InsightsPage />
    </AppLayout>
  ),
})
