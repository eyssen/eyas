import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import PromptsSettingsPage from '@/pages/settings/prompts-settings'

export const Route = createFileRoute('/prompts')({
  component: () => (
    <AppLayout>
      <PromptsSettingsPage />
    </AppLayout>
  ),
})
