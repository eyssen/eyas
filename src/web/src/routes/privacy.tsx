import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import PrivacyPage from '@/pages/privacy/privacy-page'

export const Route = createFileRoute('/privacy')({
  component: () => (
    <AppLayout>
      <PrivacyPage />
    </AppLayout>
  ),
})
