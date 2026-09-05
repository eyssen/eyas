// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/media/index.ts
//
// Vendor-neutral media gateway. Provider submodules (Magnific / Higgsfield /
// fal) register themselves onto ctx.media; none is default. Zero providers
// is a valid, fail-closed empty state.

import { sql } from 'drizzle-orm'
import type { EyasDb, EyasModule, ModuleContext } from '@core/types'
import { WS_TOPICS } from '@shared/ws-topics.js'
import { createMediaGateway } from './gateway.js'
import { createIngest } from './ingest.js'
import { createMediaTables } from './schema.js'
import { load as loadMediaSettings, save as saveMediaSettings } from './settings-store.js'
import { createMediaTools } from './tools.js'
import type { MediaGateway, MediaSettings } from './types.js'
import { magnificManifest } from './submodules/magnific/manifest.js'
import { higgsfieldManifest } from './submodules/higgsfield/manifest.js'
import { falManifest } from './submodules/fal/manifest.js'

function sumJobCredits(db: EyasDb, providerId: string, sinceIso: string): number {
  const row = db.get<{ total: number | null }>(
    sql`SELECT COALESCE(SUM(credits), 0) AS total FROM media_jobs
        WHERE provider_id = ${providerId} AND created_at >= ${sinceIso}`,
  )
  return Number(row?.total ?? 0)
}

export const mediaModule: EyasModule = {
  id: 'media',
  name: 'Media',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Vendor-neutral media generation gateway (Magnific, Higgsfield, fal)',
  dependencies: ['secrets', 'tools'],
  optional: ['documents', 'conversations', 'communication', 'audit'],
  submodules: [magnificManifest, higgsfieldManifest, falManifest],

  async onRegister(ctx: ModuleContext) {
    createMediaTables(ctx.db)

    try {
      ctx.permissions.registerSubject('Media', {
        actions: ['read', 'create', 'manage'],
        defaults: {
          owner: ['manage'],
          admin: ['manage'],
          user: ['read', 'create'],
          agent: ['create'],
          guest: [],
        },
      })
    } catch {
      // Already registered — registerSubject throws on a duplicate and would kill boot.
    }

    ctx.logger.info('Media module registered')
  },

  async onStart(ctx: ModuleContext) {
    const documents = ctx.hasModule('documents') ? (ctx as any).documents : undefined
    const ingest = documents ? createIngest({ documents }) : undefined

    const gateway = createMediaGateway({
      db: ctx.db,
      logger: ctx.logger,
      ingest,
      onSave: (job) => {
        ctx.bus.emit('eyas.media.job.updated', { job })
        try {
          ;(ctx as any).wsRegistry?.broadcast(WS_TOPICS.media, { type: 'refetch' })
        } catch {
          /* WS optional at boot */
        }
      },
    })

    const settingsApi = {
      load: (): MediaSettings => loadMediaSettings(ctx.db),
      save: (s: MediaSettings) => saveMediaSettings(ctx.db, s),
    }

    Object.assign(gateway, {
      gateway,
      settings: settingsApi,
      generate: gateway.generate.bind(gateway),
      listJobs: gateway.listJobs.bind(gateway),
      registerProvider: gateway.registerProvider.bind(gateway),
    })
    ;(ctx as any).media = gateway

    const mcp = (ctx as any).communication?.mcpClient ?? (ctx as any).mcpClient
    if (mcp?.setShouldRegisterRawTools) {
      mcp.setShouldRegisterRawTools(() => loadMediaSettings(ctx.db).expertRawMcpTools)
    }

    for (const sub of mediaModule.submodules ?? []) {
      if (sub.enabled && sub.onStart) {
        try {
          await sub.onStart(ctx)
        } catch (err) {
          ctx.logger.warn({ err, submodule: sub.id }, 'Media submodule onStart failed')
        }
      }
    }

    const registry = (ctx as any).tools?.registry
    if (registry) {
      for (const tool of createMediaTools({
        getGateway: () => (ctx as any).media as MediaGateway | undefined,
        getSettings: () => loadMediaSettings(ctx.db),
        sumCredits: (providerId, sinceIso) => sumJobCredits(ctx.db, providerId, sinceIso),
      })) {
        try {
          if (!registry.has?.(tool.name)) registry.register(tool)
        } catch (err) {
          ctx.logger.warn({ err, tool: tool.name }, 'Media tool registration skipped')
        }
      }
    }

    const { createMediaRoutes } = await import('./routes.js')
    const publicBaseUrl = ctx.config.baseUrl
      ?? `http://127.0.0.1:${ctx.config.server.port}`
    createMediaRoutes(ctx.http, gateway, settingsApi, {
      mcp,
      secrets: ctx.secrets,
      db: ctx.db,
      publicBaseUrl,
    })

    ctx.logger.info('Media module started')
  },

  async onStop() {},
}
