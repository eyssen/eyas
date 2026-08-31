import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import DesignPage from '@/pages/design/design-page'

function DesignLayout() {
  const childMatch = useMatch({ from: '/design/$designId', shouldThrow: false })
  if (childMatch) return <Outlet />
  return (
    <AppLayout>
      <DesignPage />
    </AppLayout>
  )
}

export const Route = createFileRoute('/design')({
  component: DesignLayout,
})
