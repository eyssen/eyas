// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import {
  createHiggsfieldAdapter,
  HIGGSFIELD_REST_FALLBACK_ERROR,
} from '@modules/media/submodules/higgsfield/adapter'
import { higgsfieldManifest } from '@modules/media/submodules/higgsfield/manifest'
import type { McpClient } from '@modules/communication/submodules/mcp-client/client.js'
import type { McpServerInput, McpServerRecord } from '@modules/communication/submodules/mcp-client/types.js'
import type { JsonRpcResponse } from '@modules/communication/submodules/mcp-client/types.js'
import type { MediaProvider } from '@modules/media/types'
import fixture from './fixtures/higgsfield-tools.json' with { type: 'json' }

const COMPLETED_TEXT = '{"task_id":"t1","status":"COMPLETED","url":"https://cdn/x.png"}'
const SECRET_REQUESTER = { userId: 'system', role: 'owner', trusted: true } as const

type Call = { serverId: string; name: string; args: Record<string, unknown> }
type SecretGet = { name: string; scope: string; requester: unknown }

function row(over: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'sid-1',
    name: 'higgsfield',
    transport: 'sse',
    url: 'https://mcp.higgsfield.ai/mcp',
    command: null,
    args: null,
    env: null,
    apiKey: null,
    headers: null,
    authType: 'oauth',
    ownedBy: 'media',
    enabled: 1,
    autoStart: 1,
    discoveredTools: null,
    discoveredResources: null,
    discoveredPrompts: null,
    status: 'disconnected',
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  }
}

function textResult(text: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } }
}

function setup(opts?: {
  callTool?: McpClient['callTool']
  connectImpl?: McpClient['connect']
  existing?: McpServerRecord[]
  secrets?: Record<string, string>
}) {
  const servers: McpServerRecord[] = [...(opts?.existing ?? [])]
  const calls: Call[] = []
  const added: McpServerInput[] = []
  const connected: string[] = []
  const secretGets: SecretGet[] = []
  const vault = { ...(opts?.secrets ?? {}) }

  const mcp: Pick<McpClient, 'callTool' | 'list' | 'add' | 'connect' | 'disconnect' | 'get'> = {
    list: () => servers,
    get: (id) => servers.find((s) => s.id === id) ?? null,
    add: async (input) => {
      added.push(input)
      const rec = row({
        id: 'sid-new',
        name: input.name,
        transport: input.transport,
        url: input.url ?? null,
        authType: input.authType ?? 'oauth',
        ownedBy: input.ownedBy ?? null,
        autoStart: input.autoStart === false ? 0 : 1,
        status: 'disconnected',
      })
      servers.push(rec)
      return rec
    },
    connect: async (id) => {
      connected.push(id)
      if (opts?.connectImpl) return opts.connectImpl(id)
      const rec = servers.find((s) => s.id === id)
      if (rec) rec.status = 'connected'
      return { tools: [], resources: [], prompts: [] }
    },
    disconnect: async (id) => {
      const rec = servers.find((s) => s.id === id)
      if (rec) rec.status = 'disconnected'
    },
    callTool: async (serverId, name, args) => {
      calls.push({ serverId, name, args })
      if (opts?.callTool) return opts.callTool(serverId, name, args)
      return textResult(COMPLETED_TEXT)
    },
  }

  const secrets = {
    get: async (name: string, scope: string, requester?: unknown) => {
      secretGets.push({ name, scope, requester })
      return vault[name] ?? null
    },
  }

  const adapter = createHiggsfieldAdapter({
    mcp,
    secrets,
    logger: pino({ enabled: false }),
  })

  return { adapter, mcp, servers, calls, added, connected, vault, secrets, secretGets }
}

describe('Higgsfield adapter fixture', () => {
  it('lists spec §11.2 MCP tool names', () => {
    expect(fixture.map((t) => t.name)).toEqual([
      'generate_image',
      'generate_video',
      'creations_wait',
      'account_balance',
    ])
  })
})

describe('createHiggsfieldAdapter', () => {
  it('has id higgsfield and all media kinds', () => {
    const { adapter } = setup()
    expect(adapter.id).toBe('higgsfield')
    expect(adapter.name).toBe('Higgsfield')
    expect([...adapter.capabilities]).toEqual(['image', 'video', 'audio', 'upscale', 'edit', '3d'])
    expect(adapter.configured).toBe(false)
  })

  it('connect find-or-adds the Higgsfield MCP server then connects', async () => {
    const { adapter, added, connected, servers } = setup()
    await adapter.connect()
    expect(added).toEqual([
      {
        name: 'higgsfield',
        transport: 'sse',
        url: 'https://mcp.higgsfield.ai/mcp',
        authType: 'oauth',
        ownedBy: 'media',
        autoStart: true,
      },
    ])
    expect(connected).toEqual(['sid-new'])
    expect(servers[0]!.status).toBe('connected')
    expect(adapter.configured).toBe(true)
  })

  it('connect reuses an existing higgsfield row and does not add again', async () => {
    const { adapter, added, connected } = setup({ existing: [row({ id: 'already' })] })
    await adapter.connect()
    expect(added).toEqual([])
    expect(connected).toEqual(['already'])
  })

  it('configured is true when oauth access secret exists even if MCP connect fails', async () => {
    const { adapter } = setup({
      existing: [row({ id: 'sid-1', status: 'disconnected' })],
      secrets: { 'mcp-oauth-sid-1-access': 'tok' },
      connectImpl: async () => {
        throw new Error('oauth handshake pending')
      },
    })
    await expect(adapter.connect()).rejects.toThrow(/oauth handshake pending/)
    expect(adapter.configured).toBe(true)
  })

  it('generate image calls generate_image and parses JSON in text content', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    const job = await adapter.generate({ kind: 'image', prompt: 'a lamp' })
    expect(calls.map((c) => c.name)).toContain('generate_image')
    expect(calls[0]!.args.prompt).toBe('a lamp')
    expect(job.providerId).toBe('higgsfield')
    expect(job.providerJobId).toBe('t1')
    expect(job.status).toBe('completed')
    expect(job.resultUrls).toEqual(['https://cdn/x.png'])
    expect(job.error).toBeNull()
  })

  it('generate video calls generate_video', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    const job = await adapter.generate({ kind: 'video', prompt: 'waves' })
    expect(calls[0]!.name).toBe('generate_video')
    expect(calls[0]!.args.prompt).toBe('waves')
    expect(job.providerId).toBe('higgsfield')
    expect(job.status).toBe('completed')
  })

  it('parses a structured result without text content', async () => {
    const { adapter } = setup({
      callTool: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: { task_id: 't2', status: 'CREATED' },
      }),
    })
    await adapter.connect()
    const job = await adapter.generate({ kind: 'image', prompt: 'x' })
    expect(job.providerJobId).toBe('t2')
    expect(job.status).toBe('queued')
    expect(job.resultUrls).toEqual([])
    expect(job.completedAt).toBeNull()
  })

  it('marks the job failed when callTool returns { error }', async () => {
    const { adapter } = setup({
      callTool: async () => ({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'out of credits' },
      }),
    })
    await adapter.connect()
    const job = await adapter.generate({ kind: 'image', prompt: 'x' })
    expect(job.status).toBe('failed')
    expect(job.error).toBe('out of credits')
    expect(job.resultUrls).toEqual([])
  })

  it('status polls creations_wait', async () => {
    const { adapter, calls } = setup({
      callTool: async (_id, name) => {
        if (name === 'creations_wait') {
          return textResult('{"task_id":"t1","status":"COMPLETED","url":"https://cdn/done.png"}')
        }
        return textResult(COMPLETED_TEXT)
      },
    })
    await adapter.connect()
    const patch = await adapter.status('t1')
    expect(calls.some((c) => c.name === 'creations_wait' && c.args.task_id === 't1')).toBe(true)
    expect(patch.status).toBe('completed')
    expect(patch.resultUrls).toEqual(['https://cdn/done.png'])
  })

  it('catalog does not invent model endpoints', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    const all = await adapter.catalog()
    expect(all).toEqual([])
    expect(calls).toEqual([])
    const images = await adapter.catalog('image')
    expect(images).toEqual([])
  })

  it('balance calls account_balance', async () => {
    const { adapter, calls } = setup({
      callTool: async (_id, name) => {
        if (name === 'account_balance') {
          return { jsonrpc: '2.0', id: 1, result: { credits: 42, unit: 'credits' } }
        }
        return textResult(COMPLETED_TEXT)
      },
    })
    await adapter.connect()
    const bal = await adapter.balance()
    expect(calls.map((c) => c.name)).toContain('account_balance')
    expect(bal).toMatchObject({ providerId: 'higgsfield', credits: 42, unit: 'credits' })
  })

  it('configured stays true with REST key+secret when MCP is unconfigured; generate throws stub', async () => {
    const { adapter, calls, secretGets } = setup({
      existing: [row({ id: 'sid-1', status: 'disconnected' })],
      secrets: {
        'higgsfield-api-key': 'hk',
        'higgsfield-api-secret': 'hs',
      },
      connectImpl: async () => {
        throw new Error('oauth handshake pending')
      },
    })
    await expect(adapter.connect()).rejects.toThrow(/oauth handshake pending/)
    expect(adapter.configured).toBe(true)
    expect(secretGets).toContainEqual({
      name: 'higgsfield-api-key',
      scope: 'system',
      requester: SECRET_REQUESTER,
    })
    expect(secretGets).toContainEqual({
      name: 'higgsfield-api-secret',
      scope: 'system',
      requester: SECRET_REQUESTER,
    })
    await expect(adapter.generate({ kind: 'image', prompt: 'x' })).rejects.toThrow(
      HIGGSFIELD_REST_FALLBACK_ERROR,
    )
    expect(calls).toEqual([])
  })

  it('a single REST secret does not mark REST configured', async () => {
    const { adapter } = setup({
      existing: [row({ id: 'sid-1', status: 'disconnected' })],
      secrets: { 'higgsfield-api-key': 'hk' },
      connectImpl: async () => {
        throw new Error('oauth handshake pending')
      },
    })
    await expect(adapter.connect()).rejects.toThrow(/oauth handshake pending/)
    expect(adapter.configured).toBe(false)
  })

  it('prefers MCP generate when connected even if REST secrets exist', async () => {
    const { adapter, calls } = setup({
      secrets: {
        'higgsfield-api-key': 'hk',
        'higgsfield-api-secret': 'hs',
      },
    })
    await adapter.connect()
    const job = await adapter.generate({ kind: 'image', prompt: 'a lamp' })
    expect(calls[0]!.name).toBe('generate_image')
    expect(job.status).toBe('completed')
  })
})

describe('higgsfieldManifest.onStart', () => {
  it('registers the adapter even when connect throws', async () => {
    const registered: MediaProvider[] = []
    const { mcp } = setup({
      connectImpl: async () => {
        throw new Error('network down')
      },
    })
    const warnings: string[] = []
    const ctx = {
      communication: { mcpClient: mcp },
      secrets: { get: async () => null },
      logger: {
        warn: (_obj: unknown, msg?: string) => { warnings.push(String(msg ?? _obj)) },
        info: () => {},
      },
      media: {
        registerProvider: (p: MediaProvider) => { registered.push(p) },
      },
    }
    await expect(higgsfieldManifest.onStart?.(ctx as any)).resolves.toBeUndefined()
    expect(registered).toHaveLength(1)
    expect(registered[0]!.id).toBe('higgsfield')
    expect(warnings.some((w) => /Higgsfield/i.test(w))).toBe(true)
  })
})
