// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import OpencodePage from '@/pages/opencode/opencode-page'

export const Route = createFileRoute('/opencode')({
  component: () => (
    <AppLayout>
      <OpencodePage />
    </AppLayout>
  ),
})
