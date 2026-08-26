import { describe, it, expect } from 'vitest'
import { createVoiceService, mergeVoiceConfig } from '@modules/voice/service'

describe('voice service', () => {
  it('defaults to disabled', () => {
    const cfg = mergeVoiceConfig(undefined)
    expect(cfg.enabled).toBe(false)
    expect(cfg.defaultMode).toBe('auto')
  })

  it('resolveMode auto depends on inbound modality', () => {
    const voice = createVoiceService({
      config: mergeVoiceConfig({ enabled: false, defaultMode: 'auto' }),
      logger: { debug() {}, info() {}, warn() {}, error() {} } as any,
    })
    expect(voice.resolveMode(null, true)).toBe('voice')
    expect(voice.resolveMode(null, false)).toBe('text')
  })

  it('per-agent mode overrides default', () => {
    const voice = createVoiceService({
      config: mergeVoiceConfig({ defaultMode: 'text' }),
      logger: { debug() {}, info() {}, warn() {}, error() {} } as any,
    })
    voice.setAgentMode('agent-1', 'voice')
    expect(voice.resolveMode('agent-1', false)).toBe('voice')
    expect(voice.resolveMode('agent-2', false)).toBe('text')
  })
})
