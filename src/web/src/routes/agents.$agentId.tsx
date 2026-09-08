import { createFileRoute } from '@tanstack/react-router'
import AgentDetailPage from '@/pages/agents/agent-detail-page'

export const Route = createFileRoute('/agents/$agentId')({
  component: AgentDetailPage,
})
