import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import CommunicationPage from '@/pages/communication/communication-page'

export const Route = createFileRoute('/communication')({
  component: () => (
    <AppLayout>
      <CommunicationPage />
    </AppLayout>
  ),
})
