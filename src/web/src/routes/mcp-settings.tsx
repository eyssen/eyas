import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import McpSettingsPage from '@/pages/mcp/mcp-settings-page'

export const Route = createFileRoute('/mcp-settings')({
  component: () => (
    <AppLayout>
      <McpSettingsPage />
    </AppLayout>
  ),
})
