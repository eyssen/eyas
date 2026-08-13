// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createArtifactTables } from './schema.js'
import { createArtifactService } from './artifact-service.js'
import { artifactsManifest } from './manifest.js'

export * from './types.js'
export * from './validators/index.js'
export { createArtifactService, ArtifactValidationError, UnknownArtifactKindError } from './artifact-service.js'
export { createArtifactTables } from './schema.js'

export const artifactsModule: EyasModule = {
  ...artifactsManifest,

  async onRegister(ctx: ModuleContext) {
    createArtifactTables(ctx.db)

    // Register the CASL subject so role definitions can grant access dynamically.
    try {
      ctx.permissions.registerSubject('Artifact', {
        actions: ['read', 'create', 'update', 'manage'],
        defaults: {
          owner: ['manage'],
          admin: ['manage'],
          user: ['read', 'create', 'update'],
          agent: ['read', 'create', 'update'],
          guest: ['read'],
        },
      })
    } catch {
      // Already registered (hot-reload or duplicate bootstrap) — ignore.
    }

    ctx.logger.info('Artifacts module registered')
  },

  async onStart(ctx: ModuleContext) {
    const service = createArtifactService(ctx.db)
    ;(ctx as any).artifacts = service

    const { createArtifactRoutes } = await import('./routes.js')
    createArtifactRoutes(ctx.http, service, ctx.logger)

    ctx.logger.info('Artifacts module started')
  },

  async onStop() {
    // No background workers to shut down.
  },
}
