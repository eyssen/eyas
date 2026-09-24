// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Studio — local, agent-authored production engines (not Media).
// Media is SaaS prompt→pixel. Studio engines write files and render them
// on this machine. Hyperframes is the first engine; more will follow.

import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { EyasModule, ModuleContext } from '@core/types'
import { resolveInstance } from '@core/instance.js'
import { WS_TOPICS } from '@shared/ws-topics.js'
import { createStudioTables } from './schema.js'
import { createStudioGateway } from './gateway.js'
import { createStudioIngest } from './ingest.js'
import { load as loadStudioSettings, save as saveStudioSettings } from './settings-store.js'
import { hyperframesManifest } from './submodules/hyperframes/manifest.js'
import { videouseManifest } from './submodules/videouse/manifest.js'
import type { StudioGateway } from './types.js'

export const studioModule: EyasModule = {
  id: 'studio',
  name: 'Studio',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Local production engines (Hyperframes HTML→MP4, Video Use footage→MP4). Not Media.',
  dependencies: ['permissions', 'auth', 'tools'],
  optional: ['documents', 'conversations', 'audit'],
  submodules: [hyperframesManifest, videouseManifest],

  async onRegister(ctx: ModuleContext) {
    createStudioTables(ctx.db)

    try {
      ctx.permissions.registerSubject('Studio', {
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

    ctx.logger.info('Studio module registered')
  },

  async onStart(ctx: ModuleContext) {
    const dataDir = resolveInstance({ ensureDirs: false }).dataDir
    const projectsRoot = join(dataDir, 'studio')
    mkdirSync(projectsRoot, { recursive: true })

    const documents = ctx.hasModule('documents') ? (ctx as any).documents : undefined
    const ingest = documents ? createStudioIngest({ documents }) : undefined

    const gateway = createStudioGateway({
      db: ctx.db,
      logger: ctx.logger,
      projectsRoot,
      ingest,
      onSave: (job) => {
        ctx.bus.emit('eyas.studio.job.updated', { job })
        try {
          ;(ctx as any).wsRegistry?.broadcast(WS_TOPICS.studio, { type: 'refetch' })
        } catch {
          /* WS optional at boot */
        }
      },
    })

    Object.assign(gateway, { gateway })
    ;(ctx as any).studio = gateway

    for (const sub of studioModule.submodules ?? []) {
      if (sub.enabled && sub.onStart) {
        try {
          await sub.onStart(ctx)
        } catch (err) {
          ctx.logger.warn({ err, submodule: sub.id }, 'Studio submodule onStart failed')
        }
      }
    }

    const registry = (ctx as any).tools?.registry
    if (registry && gateway.getEngine('hyperframes')) {
      const { createHyperframesTools } = await import('./submodules/hyperframes/tools.js')
      for (const tool of createHyperframesTools({
        getGateway: () => (ctx as any).studio as StudioGateway | undefined,
      })) {
        try {
          if (!registry.has?.(tool.name)) registry.register(tool)
        } catch (err) {
          ctx.logger.warn({ err, tool: tool.name }, 'Hyperframes tool registration skipped')
        }
      }
    }
    if (registry && gateway.getEngine('videouse')) {
      const { createVideoUseTools } = await import('./submodules/videouse/tools.js')
      for (const tool of createVideoUseTools({
        getGateway: () => (ctx as any).studio as StudioGateway | undefined,
      })) {
        try {
          if (!registry.has?.(tool.name)) registry.register(tool)
        } catch (err) {
          ctx.logger.warn({ err, tool: tool.name }, 'Video Use tool registration skipped')
        }
      }
    }

    const { createStudioRoutes } = await import('./routes.js')
    createStudioRoutes(ctx.http, gateway as StudioGateway, {
      load: () => loadStudioSettings(ctx.db),
      save: (s) => saveStudioSettings(ctx.db, s),
    })

    ctx.logger.info('Studio module started')
  },

  async onStop() {},
}
