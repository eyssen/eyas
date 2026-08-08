// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createCloudflareProvider } from './providers/cloudflare.js'
import type { IngressProvider } from './types.js'

export const ingressModule: EyasModule = {
  id: 'ingress',
  name: 'Ingress',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Remote access gateway with provider pattern (Cloudflare Tunnel)',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    ctx.logger.info('Ingress module registered')
  },

  async onStart(ctx: ModuleContext) {
    // TODO: Read provider from config/personality/ingress.yaml
    const provider: IngressProvider = createCloudflareProvider()
    ;(ctx as any).ingress = provider

    const { createIngressRoutes } = await import('./routes.js')
    createIngressRoutes(ctx.http, provider)
    ctx.logger.info('Ingress module started')
  },

  async onStop(ctx: ModuleContext) {
    const provider = (ctx as any).ingress as IngressProvider | undefined
    if (provider) {
      await provider.stop()
    }
  },
}
