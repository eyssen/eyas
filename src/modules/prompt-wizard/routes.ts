// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import type { createWizardService } from './wizard-service.js'

type WizardService = ReturnType<typeof createWizardService>

export function createPromptWizardRoutes(app: Hono, wizard: WizardService, assembler?: any) {
  const api = new Hono()

  api.get('/prompts', requirePermission('read', 'Prompt'), (c) => {
    const level = c.req.query('level')
    const templates = wizard.list(level as any)
    return c.json({ templates })
  })

  api.get('/prompts/:id', requirePermission('read', 'Prompt'), (c) => {
    const template = wizard.get(c.req.param('id'))
    if (!template) return c.json({ error: 'Template not found' }, 404)
    return c.json({ template })
  })

  api.post('/prompts', requirePermission('create', 'Prompt'), async (c) => {
    const body = await c.req.json()
    const template = wizard.create(body)
    return c.json({ template }, 201)
  })

  api.patch('/prompts/:id', requirePermission('update', 'Prompt'), async (c) => {
    const body = await c.req.json()
    wizard.update(c.req.param('id'), body)
    const template = wizard.get(c.req.param('id'))
    return c.json({ template })
  })

  api.delete('/prompts/:id', requirePermission('delete', 'Prompt'), (c) => {
    wizard.delete(c.req.param('id'))
    return c.json({ message: 'Template deleted' })
  })

  // Build prompt chain for a conversation
  api.post('/prompts/build-chain', requirePermission('read', 'Prompt'), async (c) => {
    const { conversationPrompt, projectId, projectTypeId } = await c.req.json()
    const chain = wizard.buildChainForConversation(conversationPrompt, projectId, projectTypeId)
    return c.json({ prompt: chain })
  })

  // Preview assembled prompt for an agent (by agentId)
  if (assembler) {
    api.get('/prompts/preview/:agentId', requirePermission('read', 'Prompt'), async (c) => {
      try {
        const result = await assembler.buildForPrimary({
          agentId: c.req.param('agentId'),
          agentName: c.req.param('agentId'),
          conversationId: null,
          projectId: null,
          channelContext: null,
        })
        return c.json(result)
      } catch (err: any) {
        return c.json({ error: err.message }, 400)
      }
    })
  }

  // Get master prompt sections (for Prompt Settings UI)
  api.get('/prompts/master', requirePermission('read', 'Prompt'), (c) => {
    const templates = wizard.list('master')
    const sections = templates.map(t => ({
      id: t.id,
      section: t.section,
      name: t.name,
      content: t.content,
      locked: t.locked,
    }))
    return c.json({ sections })
  })

  // Update personality section
  api.patch('/prompts/master/personality', requirePermission('update', 'Prompt'), async (c) => {
    const { content } = await c.req.json()
    if (!content || typeof content !== 'string') {
      return c.json({ error: 'content is required' }, 400)
    }
    const templates = wizard.list('master')
    const personality = templates.find(t => t.section === 'personality')
    if (!personality) {
      return c.json({ error: 'Personality section not found' }, 404)
    }
    if (personality.locked) {
      return c.json({ error: 'Cannot update locked section' }, 403)
    }
    wizard.update(personality.id, { content })
    const updated = wizard.get(personality.id)
    return c.json({ section: updated })
  })

  app.route('/api/v1', api)
}
