import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ConversationPage from '@/pages/conversations/conversation-page'

export const Route = createFileRoute('/conversations/$conversationId')({
  component: () => (
    // Full-bleed: the page fills the chrome remainder and owns its own scroll
    // surfaces. Default p-6 plus a 100vh calc used to overflow the status bar
    // by ~1cm, and message scrollIntoView then hid the conversation header.
    <AppLayout noPadding>
      <ConversationPage />
    </AppLayout>
  ),
})
