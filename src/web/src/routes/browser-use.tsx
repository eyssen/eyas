// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createFileRoute } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout/app-layout'
import BrowserUsePage from '@/pages/browser-use/browser-use-page'

export const Route = createFileRoute('/browser-use')({
  component: () => (
    <AppLayout>
      <BrowserUsePage />
    </AppLayout>
  ),
})
