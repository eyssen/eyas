// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { VoiceConfig, VoiceMode, VoiceService } from './types.js'
import { createLocalVoiceEngines } from './local-engines.js'

const DEFAULT_CONFIG: VoiceConfig = {
  enabled: false,
  defaultMode: 'auto',
  stt: {
    // Operator installs whisper.cpp or a wrapper. Example:
    // whisper-cli -f {input} -l {language} -otxt -of {output without ext}
    // Default is a portable shim script under scripts/voice/.
    command: 'bash scripts/voice/stt.sh {input} {output} {language}',
    language: 'hu',
    timeoutMs: 120_000,
  },
  tts: {
    command: 'bash scripts/voice/tts.sh {input} {output} {voice}',
    voice: 'hu_HU-imre-medium',
    timeoutMs: 60_000,
  },
  workDir: 'data/voice',
}

export function mergeVoiceConfig(partial?: Partial<VoiceConfig> | null): VoiceConfig {
  if (!partial) return { ...DEFAULT_CONFIG, stt: { ...DEFAULT_CONFIG.stt }, tts: { ...DEFAULT_CONFIG.tts } }
  return {
    enabled: partial.enabled ?? DEFAULT_CONFIG.enabled,
    defaultMode: partial.defaultMode ?? DEFAULT_CONFIG.defaultMode,
    stt: { ...DEFAULT_CONFIG.stt, ...(partial.stt ?? {}) },
    tts: { ...DEFAULT_CONFIG.tts, ...(partial.tts ?? {}) },
    workDir: partial.workDir ?? DEFAULT_CONFIG.workDir,
  }
}

export function createVoiceService(opts: {
  config: VoiceConfig
  logger: Logger
  /** Optional DB-backed agent mode overrides (agentId → mode). */
  loadAgentModes?: () => Map<string, VoiceMode>
  saveAgentMode?: (agentId: string, mode: VoiceMode) => void
}): VoiceService {
  const config = opts.config
  const engines = createLocalVoiceEngines(config, opts.logger)
  const agentModes = opts.loadAgentModes?.() ?? new Map<string, VoiceMode>()

  return {
    config,

    async isAvailable() {
      if (!config.enabled) return { stt: false, tts: false }
      return engines.probe()
    },

    async transcribe(audioPath) {
      if (!config.enabled) throw new Error('Voice module disabled (config.voice.enabled=false)')
      return engines.transcribe(audioPath)
    },

    async synthesize(text, synthOpts) {
      if (!config.enabled) throw new Error('Voice module disabled (config.voice.enabled=false)')
      return engines.synthesize(text, synthOpts)
    },

    resolveMode(agentId, inboundWasVoice) {
      const configured = (agentId && agentModes.get(agentId)) || config.defaultMode
      if (configured === 'auto') return inboundWasVoice ? 'voice' : 'text'
      return configured
    },

    setAgentMode(agentId, mode) {
      agentModes.set(agentId, mode)
      opts.saveAgentMode?.(agentId, mode)
    },

    getAgentMode(agentId) {
      return agentModes.get(agentId) ?? null
    },
  }
}

export { DEFAULT_CONFIG as DEFAULT_VOICE_CONFIG }
