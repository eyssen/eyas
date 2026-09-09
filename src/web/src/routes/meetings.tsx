import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import MeetingsPage from '@/pages/meetings/meetings-page'

export const Route = createFileRoute('/meetings')({
  component: () => (
    <AppLayout>
      <MeetingsPage />
    </AppLayout>
  ),
})
