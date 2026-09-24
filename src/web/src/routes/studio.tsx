// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import StudioPage from '@/pages/studio/studio-page'

export const Route = createFileRoute('/studio')({
  component: () => (
    <AppLayout>
      <StudioPage />
    </AppLayout>
  ),
})
