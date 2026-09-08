import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import BackupPage from '@/pages/backup/backup-page'

export const Route = createFileRoute('/backup')({
  component: () => (
    <AppLayout>
      <BackupPage />
    </AppLayout>
  ),
})
