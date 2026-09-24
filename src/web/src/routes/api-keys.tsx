import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ApiKeysPage from '@/pages/api-keys/api-keys-page'

export const Route = createFileRoute('/api-keys')({
  component: () => (
    <AppLayout>
      <ApiKeysPage />
    </AppLayout>
  ),
})
