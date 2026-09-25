import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import ForgePage from '@/pages/forge/forge-page'

export const Route = createFileRoute('/forge')({
  component: () => (
    <AppLayout>
      <ForgePage />
    </AppLayout>
  ),
})
