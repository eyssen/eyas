import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ExtensionsPage from '@/pages/extensions/extensions-page'

export const Route = createFileRoute('/extensions')({
  component: () => (
    <AppLayout>
      <ExtensionsPage />
    </AppLayout>
  ),
})
