import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ProvidersPage from '@/pages/providers/providers-page'

export const Route = createFileRoute('/providers')({
  component: () => (
    <AppLayout>
      <ProvidersPage />
    </AppLayout>
  ),
})
