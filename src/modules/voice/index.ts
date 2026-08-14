// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createVoiceService, mergeVoiceConfig } from './service.js'
import { createVoiceRoutes } from './routes.js'
import type { VoiceMode } from './types.js'

export const voiceModule: EyasModule = {
  id: 'voice',
  name: 'Voice',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Local speech STT/TTS (Whisper + Piper) for channel voice messages',
  dependencies: [],
  optional: [],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS voice_agent_modes (
      agent_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('text', 'voice', 'auto')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    try {
      ;(ctx as any).permissions?.registerSubject?.('Voice', {
        actions: ['read', 'update', 'execute'],
        defaults: { owner: ['execute'], admin: ['execute'], user: ['read'], agent: ['execute'], guest: [] },
      })
    } catch { /* already registered */ }
    ctx.logger.info('Voice module registered')
  },

  async onStart(ctx: ModuleContext) {
    const cfg = mergeVoiceConfig((ctx.config as any).voice)
    const voice = createVoiceService({
      config: cfg,
      logger: ctx.logger,
      loadAgentModes: () => {
        const map = new Map<string, VoiceMode>()
        try {
          const rows = ctx.db.all(sql`SELECT agent_id, mode FROM voice_agent_modes`) as Array<{ agent_id: string; mode: VoiceMode }>
          for (const r of rows) map.set(r.agent_id, r.mode)
        } catch { /* table may not exist in tests */ }
        return map
      },
      saveAgentMode: (agentId, mode) => {
        ctx.db.run(sql`
          INSERT INTO voice_agent_modes (agent_id, mode, updated_at)
          VALUES (${agentId}, ${mode}, datetime('now'))
          ON CONFLICT(agent_id) DO UPDATE SET mode = ${mode}, updated_at = datetime('now')
        `)
      },
    })
    ;(ctx as any).voice = voice
    createVoiceRoutes(ctx.http, voice)
    if (cfg.enabled) {
      const avail = await voice.isAvailable()
      ctx.logger.info({ avail }, 'Voice module started (local STT/TTS)')
    } else {
      ctx.logger.info('Voice module started (disabled — set voice.enabled: true)')
    }
  },

  async onStop() {},
}

export type { VoiceService, VoiceConfig, VoiceMode } from './types.js'
