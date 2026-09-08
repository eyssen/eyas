// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createClientWikiTables } from './schema.js'
import { createClientWikiService } from './wiki-service.js'
import { createClientWikiRoutes } from './routes.js'

export const clientWikiModule: EyasModule = {
  id: 'client-wiki',
  name: 'Client Wiki',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Per-project living knowledge base. Pages, revisions, backlinks, ticket/decision auto-update.',
  dependencies: [],
  optional: ['search', 'model', 'memory', 'conversations', 'chatter', 'board'],
  capabilities: ['client-wiki.read', 'client-wiki.write', 'client-wiki.auto-update'],

  async onRegister(ctx: ModuleContext) {
    createClientWikiTables(ctx.db)

    // CASL subject. Wikis are per-client collaborative docs: regular users and
    // agents can read/write pages; destructive operations (purge, restore) are
    // limited to owner/admin. Auto-maintenance runs under the 'agent' role
    // identity so it must be able to create revisions.
    try {
      ctx.permissions.registerSubject('ClientWikiPage', {
        actions: ['read', 'create', 'update', 'delete', 'manage'],
        defaults: {
          owner: ['manage'],
          admin: ['manage'],
          user: ['read', 'create', 'update'],
          agent: ['read', 'create', 'update'],
          guest: ['read'],
        },
      })
    } catch {
      // Already registered — safe to ignore.
    }

    ctx.logger.info('Client wiki module registered')
  },

  async onStart(ctx: ModuleContext) {
    const service = createClientWikiService(ctx.db)
    ;(ctx as any).clientWiki = service

    createClientWikiRoutes(ctx.http, service, ctx.logger)

    const { createWikiAutoUpdate } = await import('./auto-update.js')
    const auto = createWikiAutoUpdate({
      wiki: service,
      conversations: {
        get: (id) => (ctx.conversations?.get(id) as any) ?? null,
      },
      stages: {
        get: (id) => (ctx as any).board?.stages?.get(id) ?? null,
      },
      projects: {
        get: (id) => {
          const p = (ctx as any).board?.projects?.get(id)
          if (!p) return null
          return {
            wikiAutoTickets: !!p.wikiAutoTickets,
            wikiAutoDecisions: !!p.wikiAutoDecisions,
            wikiTicketBody: p.wikiTicketBody ?? 'title',
          }
        },
      },
      logger: ctx.logger,
    })
    ;(ctx as any).wikiAutoUpdate = auto

    ctx.bus.on('eyas.conversations.stage_changed', async (data) => {
      try {
        auto.handleStageChanged(data as { conversationId: string; toStageId: string | null })
      } catch (err) {
        ctx.logger.error({ err }, 'Wiki auto-update failed')
      }
    })

    ctx.logger.info('Client wiki module started')
  },

  async onStop() {},
}

export { createClientWikiService } from './wiki-service.js'
export { createClientWikiTables } from './schema.js'
export { createClientWikiRoutes } from './routes.js'
export { createWikiAutoUpdate } from './auto-update.js'
export { ticketSlug, decisionSlug, parseWikiTicketBody } from './wiki-paths.js'
export { renderMarkdown, summarize, escapeHtml } from './markdown-render.js'
export type { ClientWikiService } from './wiki-service.js'
export type { WikiAutoUpdate } from './auto-update.js'
export * from './types.js'
