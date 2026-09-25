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
  optional: ['secrets'],

  async onRegister(ctx: ModuleContext) {
    ctx.logger.info('Ingress module registered')
  },

  async onStart(ctx: ModuleContext) {
    // TODO: Read provider from config/personality/ingress.yaml
    const provider: IngressProvider = createCloudflareProvider()
    ;(ctx as any).ingress = provider

    const trusted = { userId: 'system', role: 'owner', trusted: true }
    const getSecret = async (key: string): Promise<string | null> => {
      try {
        if (!ctx.secrets?.get) return null
        return (await ctx.secrets.get(key, 'system', trusted)) ?? null
      } catch {
        return null
      }
    }
    const setSecret = async (key: string, value: string): Promise<void> => {
      if (!ctx.secrets?.set) return
      await ctx.secrets.set(key, 'system', value, 'ingress', trusted)
    }

    const { createIngressRoutes } = await import('./routes.js')
    createIngressRoutes(ctx.http, provider, getSecret, setSecret)
    ctx.logger.info('Ingress module started')
  },

  async onStop(ctx: ModuleContext) {
    const provider = (ctx as any).ingress as IngressProvider | undefined
    if (provider) {
      await provider.stop()
    }
  },
}
