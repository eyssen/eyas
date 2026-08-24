import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ConversationPage from '@/pages/conversations/conversation-page'

export const Route = createFileRoute('/conversations/$conversationId')({
  component: () => (
    <AppLayout>
      <ConversationPage />
    </AppLayout>
  ),
})
