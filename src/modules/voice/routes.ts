// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { VoiceService, VoiceMode } from './types.js'

const VALID_MODES = new Set<VoiceMode>(['text', 'voice', 'auto'])

export function createVoiceRoutes(http: Hono, voice: VoiceService): void {
  const app = new Hono()

  app.get('/status', requirePermission('read', 'Voice'), async (c) => {
    const availability = await voice.isAvailable()
    return c.json({
      enabled: voice.config.enabled,
      defaultMode: voice.config.defaultMode,
      availability,
      stt: { language: voice.config.stt.language, command: voice.config.stt.command },
      tts: { voice: voice.config.tts.voice, command: voice.config.tts.command },
    })
  })

  app.get('/agents/:agentId/mode', requirePermission('read', 'Voice'), (c) => {
    const agentId = c.req.param('agentId')
    return c.json({
      agentId,
      mode: voice.getAgentMode(agentId) ?? voice.config.defaultMode,
      inherited: voice.getAgentMode(agentId) == null,
    })
  })

  app.put('/agents/:agentId/mode', requirePermission('update', 'Voice'), async (c) => {
    const agentId = c.req.param('agentId')
    const body = await c.req.json().catch(() => ({})) as { mode?: string }
    if (!body.mode || !VALID_MODES.has(body.mode as VoiceMode)) {
      return c.json({ error: 'mode must be text|voice|auto' }, 400)
    }
    voice.setAgentMode(agentId, body.mode as VoiceMode)
    return c.json({ agentId, mode: body.mode })
  })

  app.post('/transcribe', requirePermission('execute', 'Voice'), async (c) => {
    if (!voice.config.enabled) return c.json({ error: 'voice disabled' }, 503)
    const body = await c.req.json().catch(() => ({})) as { path?: string }
    if (!body.path) return c.json({ error: 'path required' }, 400)
    try {
      const result = await voice.transcribe(body.path)
      return c.json(result)
    } catch (err: any) {
      return c.json({ error: err?.message ?? 'STT failed' }, 500)
    }
  })

  app.post('/synthesize', requirePermission('execute', 'Voice'), async (c) => {
    if (!voice.config.enabled) return c.json({ error: 'voice disabled' }, 503)
    const body = await c.req.json().catch(() => ({})) as { text?: string; voice?: string }
    if (!body.text?.trim()) return c.json({ error: 'text required' }, 400)
    try {
      const result = await voice.synthesize(body.text, { voice: body.voice })
      return c.json(result)
    } catch (err: any) {
      return c.json({ error: err?.message ?? 'TTS failed' }, 500)
    }
  })

  http.route('/api/v1/voice', app)
}
