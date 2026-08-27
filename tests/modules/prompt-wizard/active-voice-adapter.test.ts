// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createActiveVoiceAdapter, FALLBACK_VOICE_PROFILE } from '@modules/prompt-wizard/active-voice-adapter'

describe('createActiveVoiceAdapter', () => {
  it('falls back when no resolver is wired yet', async () => {
    const adapter = createActiveVoiceAdapter(() => undefined)
    const res = await adapter({ agentId: 'a1', channelContext: null, conversationId: null })
    expect(res.scope).toBe('internal')
    expect(res.profile).toEqual(FALLBACK_VOICE_PROFILE)
    expect(res.reason).toContain('not ready')
  })

  it('falls back instead of throwing when the resolver throws', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('agent a1 has no SOUL.style.json'))
    const warn = vi.fn()
    const adapter = createActiveVoiceAdapter(() => boom, { warn })
    const res = await adapter({ agentId: 'a1', channelContext: null, conversationId: 'c1' })
    expect(res.scope).toBe('internal')
    expect(res.profile).toEqual(FALLBACK_VOICE_PROFILE)
    expect(res.reason).toContain('SOUL.style.json')
    expect(warn).toHaveBeenCalledOnce()
  })

  it('passes the resolver result through when it succeeds', async () => {
    const profile = { ...FALLBACK_VOICE_PROFILE, tone: 'baráti' as const }
    const ok = vi.fn().mockResolvedValue({ scope: 'external', reason: 'auto', source: 'auto', profile })
    const adapter = createActiveVoiceAdapter(() => ok)
    const res = await adapter({ agentId: 'a1', channelContext: null, conversationId: 'c1' })
    expect(res).toEqual({ scope: 'external', reason: 'auto', profile })
  })

  it('supplies an owner-dm channel context when the caller passes none', async () => {
    const ok = vi.fn().mockResolvedValue({ scope: 'internal', reason: 'auto', source: 'auto', profile: FALLBACK_VOICE_PROFILE })
    const adapter = createActiveVoiceAdapter(() => ok)
    await adapter({ agentId: 'a1', channelContext: null, conversationId: 'c1' })
    expect(ok.mock.calls[0][0].channelContext).toMatchObject({ conversationKind: 'owner-dm', channelType: 'web' })
  })

  it('forwards a supplied channel context unchanged', async () => {
    const ok = vi.fn().mockResolvedValue({ scope: 'external', reason: 'auto', source: 'auto', profile: FALLBACK_VOICE_PROFILE })
    const adapter = createActiveVoiceAdapter(() => ok)
    await adapter({ agentId: 'a1', channelContext: { channelType: 'telegram' }, conversationId: 'c1' })
    expect(ok.mock.calls[0][0].channelContext).toEqual({ channelType: 'telegram' })
  })
})
