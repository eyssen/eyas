import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import AgentRunsPage from '@/pages/agent-runs/agent-runs-page'

export const Route = createFileRoute('/agent-runs')({
  component: () => (
    <AppLayout>
      <AgentRunsPage />
    </AppLayout>
  ),
})
