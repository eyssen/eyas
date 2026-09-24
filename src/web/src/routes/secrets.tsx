import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import SecretsPage from '@/pages/secrets/secrets-page'

export const Route = createFileRoute('/secrets')({
  component: () => (
    <AppLayout>
      <SecretsPage />
    </AppLayout>
  ),
})
