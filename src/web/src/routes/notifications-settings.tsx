import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import NotificationSettingsPage from '@/pages/notifications/notification-settings-page'

export const Route = createFileRoute('/notifications-settings')({
  component: () => (
    <AppLayout>
      <NotificationSettingsPage />
    </AppLayout>
  ),
})
