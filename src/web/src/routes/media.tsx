// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import MediaPage from '@/pages/media/media-page'

export const Route = createFileRoute('/media')({
  component: () => (
    <AppLayout>
      <MediaPage />
    </AppLayout>
  ),
})
