import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import SettingsPage from '@/pages/settings/settings-page'

export const Route = createFileRoute('/settings')({
  component: () => (
    <AppLayout>
      <SettingsPage />
    </AppLayout>
  ),
})
