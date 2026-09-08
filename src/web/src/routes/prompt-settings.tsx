import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import PromptSettings from '@/pages/settings/prompt-settings'

export const Route = createFileRoute('/prompt-settings')({
  component: () => (
    <AppLayout>
      <PromptSettings />
    </AppLayout>
  ),
})
