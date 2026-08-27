import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import HomePage from '@/pages/home/home-page'

export const Route = createFileRoute('/')({
  component: () => (
    <AppLayout>
      <HomePage />
    </AppLayout>
  ),
})
