import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ToolsPage from '@/pages/tools/tools-page'

export const Route = createFileRoute('/tools')({
  component: () => (
    <AppLayout>
      <ToolsPage />
    </AppLayout>
  ),
})
