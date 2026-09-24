import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import UsersPage from '@/pages/users/users-page'

export const Route = createFileRoute('/users')({
  component: () => (
    <AppLayout>
      <UsersPage />
    </AppLayout>
  ),
})
