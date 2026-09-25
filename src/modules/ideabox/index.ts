// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createIdeaboxService, createIdeaboxTables } from './service.js'
import { createIdeaboxRoutes } from './routes.js'

export const ideaboxModule: EyasModule = {
  id: 'ideabox',
  name: 'Ideabox',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Idea funnel with impact×effort scoring and board promotion',
  dependencies: [],
  optional: ['board', 'conversations'],

  async onRegister(ctx: ModuleContext) {
    createIdeaboxTables(ctx.db)
    try {
      ;(ctx as any).permissions?.registerSubject?.('Ideabox', {
        actions: ['read', 'create', 'update', 'delete'],
        defaults: { owner: ['delete'], admin: ['delete'], user: ['create'], agent: ['create'], guest: [] },
      })
    } catch { /* already registered */ }
    ctx.logger.info('Ideabox module registered')
  },

  async onStart(ctx: ModuleContext) {
    const ideabox = createIdeaboxService(ctx.db)
    ;(ctx as any).ideabox = ideabox

    createIdeaboxRoutes(ctx.http, ideabox, {
      promoteToBoard: (idea) => {
        const conversations = (ctx as any).conversations
        if (!conversations?.create) {
          throw new Error('Conversations module unavailable for promotion')
        }
        const desc = [
          idea.description ?? '',
          idea.successCriteria ? `\n\nSuccess criteria: ${idea.successCriteria}` : '',
        ].join('').trim()
        const conv = conversations.create({
          title: idea.title,
          projectId: idea.projectId ?? 'general-general',
          status: 'open',
          priority: 'normal',
          initialMessage: desc || idea.title,
        })
        return conv.id ?? conv
      },
    })

    ctx.logger.info('Ideabox module started')
  },

  async onStop() {},
}
