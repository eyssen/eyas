import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'

export const Route = createFileRoute('/agents')({
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
})
