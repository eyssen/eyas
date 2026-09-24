import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import MissionControl from '@/pages/mission-control/MissionControl'
import { useAuthStore } from '@/stores/auth-store'

function MissionControlRoute() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin' || user?.role === 'owner'
  return (
    <AppLayout>
      <MissionControl
        currentUserId={user?.id ?? ''}
        isAdmin={isAdmin}
        onOpenConversation={(sessionId) =>
          navigate({ to: '/conversations/$conversationId', params: { conversationId: sessionId } })
        }
      />
    </AppLayout>
  )
}

export const Route = createFileRoute('/mission-control')({
  component: MissionControlRoute,
})
