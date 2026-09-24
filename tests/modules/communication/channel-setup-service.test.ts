// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createChannelSetupService } from '@modules/communication/channel-setup-service.js'
import { vaultSecretName } from '@modules/communication/channel-secret-keys.js'

function fakeConfigService() {
  const rows = new Map<
    string,
    {
      channelType: string
      name: string
      agentId: string | null
      mode: 'managed' | 'autonomous'
      config: Record<string, unknown>
    }
  >()
  return {
    ensureChannel: ({ channelId, channelType, name }: { channelId: string; channelType: string; name: string }) => {
      if (!rows.has(channelId)) {
        rows.set(channelId, { channelType, name, agentId: null, mode: 'managed', config: {} })
      }
    },
    getByChannelId: (id: string) => {
      const r = rows.get(id)
      if (!r) return null
      return {
        channelId: id,
        channelType: r.channelType,
        name: r.name,
        agentId: r.agentId,
        mode: r.mode,
        config: r.config,
      }
    },
    updateAgent: (id: string, agentId: string | null) => {
      const r = rows.get(id)
      if (r) r.agentId = agentId
    },
    updateMode: (id: string, mode: 'managed' | 'autonomous') => {
      const r = rows.get(id)
      if (r) r.mode = mode
    },
    updateName: (id: string, name: string) => {
      const r = rows.get(id)
      if (r) r.name = name
    },
    createInstance: (input: {
      channelType: string
      channelId: string
      name: string
      agentId?: string | null
      mode?: 'managed' | 'autonomous'
      config?: Record<string, unknown>
    }) => {
      if (rows.has(input.channelId)) throw new Error('exists')
      rows.set(input.channelId, {
        channelType: input.channelType,
        name: input.name,
        agentId: input.agentId ?? null,
        mode: input.mode === 'autonomous' ? 'autonomous' : 'managed',
        config: input.config ?? {},
      })
      return {
        channelId: input.channelId,
        channelType: input.channelType,
        name: input.name,
        agentId: input.agentId ?? null,
        mode: input.mode === 'autonomous' ? 'autonomous' : 'managed',
        config: input.config ?? {},
      }
    },
    deleteByChannelId: (id: string) => rows.delete(id),
    list: () =>
      [...rows.entries()].map(([channelId, r]) => ({
        channelId,
        channelType: r.channelType,
        name: r.name,
        agentId: r.agentId,
        mode: r.mode,
        config: r.config,
      })),
    listByTypes: (types: string[]) =>
      [...rows.entries()]
        .filter(([, r]) => types.includes(r.channelType))
        .map(([channelId, r]) => ({
          channelId,
          channelType: r.channelType,
          name: r.name,
          agentId: r.agentId,
          mode: r.mode,
          config: r.config,
        })),
  }
}

describe('vaultSecretName', () => {
  it('keeps legacy keys for default catalog instances', () => {
    expect(vaultSecretName('signal', 'signal-cli-url')).toBe('signal-cli-url')
    expect(vaultSecretName('telegram', 'telegram-bot-token')).toBe('telegram-bot-token')
  })

  it('namespaces extra instances', () => {
    expect(vaultSecretName('signal-work', 'signal-cli-url')).toBe('channel.signal-work.signal-cli-url')
  })
})

describe('channel setup service (multi-instance)', () => {
  it('lists catalog defaults as not_configured when secrets missing', async () => {
    const secrets = new Map<string, string>()
    const cfg = fakeConfigService()
    const setup = createChannelSetupService({
      router: { listChannels: () => [], getChannel: () => undefined } as any,
      channelConfigService: cfg as any,
      getSecret: async (n) => secrets.get(n),
      setSecret: async (n, v) => {
        secrets.set(n, v)
      },
      reconnect: async () => ({ connected: false }),
    })

    const list = await setup.list()
    expect(list.length).toBeGreaterThan(5)
    const tg = list.find((c) => c.id === 'telegram')!
    expect(tg.status).toBe('not_configured')
    expect(tg.isDefault).toBe(true)
  })

  it('configure writes secrets, binds primary, reconnects', async () => {
    const secrets = new Map<string, string>()
    const cfg = fakeConfigService()
    const reconnect = vi.fn(async () => ({ connected: true }))
    const setup = createChannelSetupService({
      router: {
        listChannels: () => [{ id: 'telegram', type: 'telegram', name: 'Telegram', connected: true }],
        getChannel: (id: string) =>
          id === 'telegram' ? { id: 'telegram', connected: true } : undefined,
      } as any,
      channelConfigService: cfg as any,
      getSecret: async (n) => secrets.get(n),
      setSecret: async (n, v) => {
        secrets.set(n, v)
      },
      reconnect,
      resolvePrimaryAgentId: () => 'primary-1',
    })

    const view = await setup.configure({
      channelId: 'telegram',
      secrets: { 'telegram-bot-token': 'tok' },
    })

    expect(secrets.get('telegram-bot-token')).toBe('tok')
    expect(reconnect).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: 'telegram', type: 'telegram' }),
    )
    expect(cfg.getByChannelId('telegram')?.agentId).toBe('primary-1')
    expect(view.connected).toBe(true)
    expect(await setup.isPrimaryCommReady()).toBe(true)
  })

  it('createInstance adds a second Signal with namespaced secrets and own agent', async () => {
    const secrets = new Map<string, string>()
    const cfg = fakeConfigService()
    const reconnect = vi.fn(async (input: { instanceId: string }) => ({
      connected: true,
      instanceId: input.instanceId,
    }))
    // Seed default signal row
    cfg.ensureChannel({ channelId: 'signal', channelType: 'signal', name: 'Signal' })
    cfg.updateAgent('signal', 'agent-a')

    const setup = createChannelSetupService({
      router: {
        listChannels: () => [
          { id: 'signal', type: 'signal', name: 'Signal', connected: true },
          { id: 'signal-personal', type: 'signal', name: 'Personal Signal', connected: true },
        ],
        getChannel: (id: string) => ({ id, connected: true }) as any,
      } as any,
      channelConfigService: cfg as any,
      getSecret: async (n) => secrets.get(n),
      setSecret: async (n, v) => {
        secrets.set(n, v)
      },
      reconnect: reconnect as any,
      resolvePrimaryAgentId: () => 'agent-a',
    })

    const view = await setup.createInstance({
      templateId: 'signal',
      name: 'Personal',
      agentId: 'agent-b',
      secrets: {
        'signal-cli-url': 'http://localhost:8080',
        'signal-account-number': '+15550001111',
      },
    })

    expect(view.isDefault).toBe(false)
    expect(view.agentId).toBe('agent-b')
    expect(view.type).toBe('signal')
    // Namespaced secrets for non-default instance
    const urlKey = [...secrets.keys()].find((k) => k.includes('signal-cli-url'))
    expect(urlKey).toMatch(/^channel\.signal-/)
    expect(secrets.get(urlKey!)).toBe('http://localhost:8080')

    const list = await setup.list()
    const signals = list.filter((c) => c.type === 'signal')
    expect(signals.length).toBeGreaterThanOrEqual(2)
    expect(signals.some((s) => s.agentId === 'agent-a')).toBe(true)
    expect(signals.some((s) => s.agentId === 'agent-b')).toBe(true)
  })

  it('refuses to delete default catalog instances', async () => {
    const cfg = fakeConfigService()
    cfg.ensureChannel({ channelId: 'signal', channelType: 'signal', name: 'Signal' })
    const setup = createChannelSetupService({
      router: { listChannels: () => [], getChannel: () => undefined, unregister: () => {} } as any,
      channelConfigService: cfg as any,
      getSecret: async () => undefined,
      setSecret: async () => {},
      reconnect: async () => ({ connected: false }),
    })
    await expect(setup.deleteInstance('signal')).rejects.toThrow(/default/i)
  })
})
