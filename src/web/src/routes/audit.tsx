import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import AuditPage from '@/pages/audit/audit-page'

export const Route = createFileRoute('/audit')({
  component: () => (
    <AppLayout>
      <AuditPage />
    </AppLayout>
  ),
})
