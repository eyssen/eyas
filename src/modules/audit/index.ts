// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createAuditTables } from './schema.js'
import { createAuditService, type AuditService } from './service.js'

export const auditModule: EyasModule = {
  id: 'audit',
  name: 'Audit',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Action logging, snapshots, rollback, diff tracking, and retention lifecycle',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    createAuditTables(ctx.db)

    const auditService = createAuditService(ctx.db)
    ;(ctx as any).audit = auditService
    ctx.logger.info('Audit module registered')
  },

  async onStart(ctx: ModuleContext) {
    const auditService = (ctx as any).audit as AuditService

    // Subscribe to all eyas.* bus events for automatic audit logging
    ctx.bus.on('eyas.*', async (data: unknown, emittedSubject?: string) => {
      try {
        const event = data as Record<string, any>
        const subject = emittedSubject ?? 'unknown'
        // Map event subject to action: 'eyas.board.task.created' -> 'board.task.created'
        const action = subject.startsWith('eyas.') ? subject.slice(5) : subject

        auditService.log({
          userId: event?.userId ?? null,
          action,
          module: action.split('.')[0] ?? 'system',
          target: event?.targetId ?? event?.id ?? null,
          details: event,
          costUsd: event?.costUsd ?? null,
        })
      } catch {
        // Audit logging should never break the application
      }
    })

    // Register routes
    const { createAuditRoutes } = await import('./routes.js')
    createAuditRoutes(ctx.http, auditService)

    ctx.logger.info('Audit module started')
  },

  async onStop() {},
}
