import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import HandsSettingsPage from '@/pages/settings/hands-settings'

export const Route = createFileRoute('/hands')({
  component: () => (
    <AppLayout>
      <HandsSettingsPage />
    </AppLayout>
  ),
})
