import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import IngressSettingsPage from '@/pages/ingress/ingress-settings-page'

export const Route = createFileRoute('/ingress')({
  component: () => (
    <AppLayout>
      <IngressSettingsPage />
    </AppLayout>
  ),
})
