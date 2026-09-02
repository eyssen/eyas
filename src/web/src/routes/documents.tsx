import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import DocumentsPage from '@/pages/documents/documents-page'

export const Route = createFileRoute('/documents')({
  component: () => (
    <AppLayout>
      <DocumentsPage />
    </AppLayout>
  ),
})
