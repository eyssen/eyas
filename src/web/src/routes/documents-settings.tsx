import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import DocumentsSettings from '@/pages/documents/documents-settings'

export const Route = createFileRoute('/documents-settings')({
  component: () => (
    <AppLayout>
      <DocumentsSettings />
    </AppLayout>
  ),
})
