// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, vi } from 'vitest'
import { createActiveVoiceResolver, createVoiceScopeResolver } from '../../../src/modules/communication/active-voice-resolver.js'
import { createEphemeralOverrideStore } from '../../../src/modules/communication/voice-scope-overrides.js'
import type { ChannelContext } from '../../../src/modules/communication/channel-resolver.js'
import type { AgentWorkspace, WorkspaceFile } from '../../../src/modules/prompt-wizard/workspace-types.js'

function file(name: string, body: string, exists = true): WorkspaceFile {
  return { name, path: `/fake/${name}`, exists, frontmatter: null, body, byteSize: body.length, truncated: false }
}

function workspace(soulStyleBody: string | null): AgentWorkspace {
  return {
    agentId: 'jarvis',
    rootPath: '/fake',
    identity: file('IDENTITY.md', '# I'),
    soulMd: file('SOUL.md', '# S'),
    soulStyleJson: soulStyleBody === null
      ? file('SOUL.style.json', '', false)
      : file('SOUL.style.json', soulStyleBody, true),
    agentsMd: file('AGENTS.md', ''),
    toolsMd: file('TOOLS.md', ''),
    memoryMd: file('MEMORY.md', ''),
    dailyMemory: [],
  }
}

const validStyle = JSON.stringify({
  version: 1,
  preset: { internal: 'jarvis', external: 'diplomata' },
  internal: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'száraz/szellemes', emoji: 'funkcionálisan', blockedPhrases: [], signature: 'J.' },
  external: { address: 'magázó', tone: 'kiegyensúlyozott', verbosity: 'kiegyensúlyozott', directness: 'diplomatikus', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' },
})

const ownerDmContext: ChannelContext = {
  channelType: 'web',
  conversationKind: 'owner-dm',
  participants: [{ id: 'u1', type: 'owner' }],
  origin: 'inbound',
}

const externalContext: ChannelContext = {
  channelType: 'email',
  conversationKind: 'group',
  participants: [{ id: 'u1', type: 'owner' }, { id: 'c1', type: 'known-contact' }],
  origin: 'inbound',
}

function makeDeps(opts: {
  soulStyleBody: string | null
  perConv?: 'internal' | 'external' | null
  perCh?: 'internal' | 'external' | null
  ephemeralSeed?: { conversationId: string; scope: 'internal' | 'external' }
} = { soulStyleBody: validStyle }) {
  const store = createEphemeralOverrideStore()
  if (opts.ephemeralSeed) store.set(opts.ephemeralSeed.conversationId, opts.ephemeralSeed.scope)
  return {
    workspaceLoader: {
      load: vi.fn(async () => workspace(opts.soulStyleBody) as never),
      invalidate: () => {},
      invalidateAll: () => {},
    } as never,
    ephemeralStore: store,
    loadConversationOverride: vi.fn(async () => opts.perConv ?? null),
    loadChannelForceScope: vi.fn(async () => opts.perCh ?? null),
  }
}

describe('createActiveVoiceResolver', () => {
  it('auto-resolves internal for owner DM and returns matching profile', async () => {
    const resolve = createActiveVoiceResolver(makeDeps({ soulStyleBody: validStyle }))
    const r = await resolve({
      agentId: 'jarvis',
      conversationId: 'c1',
      channelId: 'ch1',
      channelContext: ownerDmContext,
    })
    expect(r.scope).toBe('internal')
    expect(r.source).toBe('auto')
    expect(r.reason).toBe('owner DM')
    expect(r.profile.address).toBe('tegező')
  })

  it('ephemeral override beats auto-resolution', async () => {
    const resolve = createActiveVoiceResolver(makeDeps({
      soulStyleBody: validStyle,
      ephemeralSeed: { conversationId: 'c1', scope: 'external' },
    }))
    const r = await resolve({
      agentId: 'jarvis',
      conversationId: 'c1',
      channelId: 'ch1',
      channelContext: ownerDmContext,  // would auto-resolve to internal
    })
    expect(r.scope).toBe('external')
    expect(r.source).toBe('ephemeral-session')
    expect(r.reason).toBe('override (ephemeral-session)')
    expect(r.profile.address).toBe('magázó')
  })

  it('per-conversation override beats auto + per-channel', async () => {
    const resolve = createActiveVoiceResolver(makeDeps({
      soulStyleBody: validStyle,
      perConv: 'internal',
      perCh: 'external',
    }))
    const r = await resolve({
      agentId: 'jarvis',
      conversationId: 'c1',
      channelId: 'ch1',
      channelContext: externalContext,  // would auto-resolve to external
    })
    expect(r.scope).toBe('internal')
    expect(r.source).toBe('per-conversation')
    expect(r.reason).toBe('override (per-conversation)')
  })

  it('throws when SOUL.style.json is missing', async () => {
    const resolve = createActiveVoiceResolver(makeDeps({ soulStyleBody: null }))
    await expect(resolve({
      agentId: 'jarvis',
      conversationId: 'c1',
      channelId: 'ch1',
      channelContext: ownerDmContext,
    })).rejects.toThrow(/has no SOUL.style.json/)
  })
})

describe('createVoiceScopeResolver (the scope half, no style file)', () => {
  it('(+) resolves the same override chain without loading the agent workspace', async () => {
    const deps = makeDeps({ soulStyleBody: null, perConv: 'external' })
    const resolve = createVoiceScopeResolver(deps)
    const r = await resolve({ conversationId: 'c1', channelId: null, channelContext: ownerDmContext })
    expect(r).toEqual({ scope: 'external', source: 'per-conversation', reason: 'override (per-conversation)' })
    expect((deps.workspaceLoader as unknown as { load: ReturnType<typeof vi.fn> }).load).not.toHaveBeenCalled()
  })

  it('(−) no override and an owner DM: internal', async () => {
    const resolve = createVoiceScopeResolver(makeDeps({ soulStyleBody: null }))
    const r = await resolve({ conversationId: 'c1', channelId: null, channelContext: ownerDmContext })
    expect(r.scope).toBe('internal')
    expect(r.source).toBe('auto')
  })

  it('(+) agrees with the full resolver it is part of', async () => {
    const deps = makeDeps({ soulStyleBody: validStyle, ephemeralSeed: { conversationId: 'c1', scope: 'external' } })
    const input = { conversationId: 'c1', channelId: null, channelContext: ownerDmContext }
    const scope = await createVoiceScopeResolver(deps)(input)
    const voice = await createActiveVoiceResolver(deps)({ agentId: 'jarvis', ...input })
    expect(voice.scope).toBe(scope.scope)
    expect(voice.source).toBe(scope.source)
  })
})
