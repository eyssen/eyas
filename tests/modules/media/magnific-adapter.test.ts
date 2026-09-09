// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { createMagnificAdapter } from '@modules/media/submodules/magnific/adapter'
import { magnificManifest } from '@modules/media/submodules/magnific/manifest'
import type { McpClient } from '@modules/communication/submodules/mcp-client/client.js'
import type { McpServerInput, McpServerRecord } from '@modules/communication/submodules/mcp-client/types.js'
import type { JsonRpcResponse } from '@modules/communication/submodules/mcp-client/types.js'
import type { MediaProvider } from '@modules/media/types'
import fixture from './fixtures/magnific-tools.json' with { type: 'json' }

const COMPLETED_TEXT = '{"task_id":"t1","status":"COMPLETED","url":"https://cdn/x.png"}'

type Call = { serverId: string; name: string; args: Record<string, unknown> }

function row(over: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'sid-1',
    name: 'magnific',
    transport: 'sse',
    url: 'https://mcp.magnific.com',
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
    get: async (name: string) => vault[name] ?? null,
  }

  const adapter = createMagnificAdapter({
    mcp,
    secrets,
    logger: pino({ enabled: false }),
  })

  return { adapter, mcp, servers, calls, added, connected, vault, secrets }
}

describe('Magnific adapter fixture', () => {
  it('lists spec §11.1 MCP tool names', () => {
    expect(fixture.map((t) => t.name)).toEqual([
      'images_generate',
      'images_upscale',
      'video_generate',
      'audio_tts',
      'models3d_generate',
      'images_models_list',
      'video_models_list',
      'creation_status',
      'creations_wait',
      'account_balance',
    ])
  })
})

describe('createMagnificAdapter', () => {
  it('has id magnific and all media kinds', () => {
    const { adapter } = setup()
    expect(adapter.id).toBe('magnific')
    expect(adapter.name).toBe('Magnific')
    expect([...adapter.capabilities]).toEqual(['image', 'video', 'audio', 'upscale', 'edit', '3d'])
    expect(adapter.configured).toBe(false)
  })

  it('connect find-or-adds the Magnific MCP server then connects', async () => {
    const { adapter, added, connected, servers } = setup()
    await adapter.connect()
    expect(added).toEqual([
      {
        name: 'magnific',
        transport: 'sse',
        url: 'https://mcp.magnific.com',
        authType: 'oauth',
        ownedBy: 'media',
        autoStart: true,
      },
    ])
    expect(connected).toEqual(['sid-new'])
    expect(servers[0]!.status).toBe('connected')
    expect(adapter.configured).toBe(true)
  })

  it('connect reuses an existing magnific row and does not add again', async () => {
    const { adapter, added, connected } = setup({ existing: [row({ id: 'already' })] })
    await adapter.connect()
    expect(added).toEqual([])
    expect(connected).toEqual(['already'])
  })

  it('disconnect drops the MCP session and configured becomes false', async () => {
    const { adapter, servers } = setup({ existing: [row({ id: 'already', status: 'connected' })] })
    expect(adapter.configured).toBe(true)
    await adapter.disconnect?.()
    expect(servers[0]!.status).toBe('disconnected')
    expect(adapter.configured).toBe(false)
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

  it('generate image calls images_generate and parses JSON in text content', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    const job = await adapter.generate({ kind: 'image', prompt: 'a lamp' })
    expect(calls.map((c) => c.name)).toContain('images_generate')
    expect(calls[0]!.args.prompt).toBe('a lamp')
    expect(job.providerId).toBe('magnific')
    expect(job.providerJobId).toBe('t1')
    expect(job.status).toBe('completed')
    expect(job.resultUrls).toEqual(['https://cdn/x.png'])
    expect(job.error).toBeNull()
  })

  it('generate upscale calls images_upscale with mode from options', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    await adapter.generate({
      kind: 'upscale',
      prompt: 'sharpen',
      options: { mode: 'precision' },
      references: [{ url: 'https://cdn/in.png' }],
    })
    expect(calls[0]!.name).toBe('images_upscale')
    expect(calls[0]!.args.mode).toBe('precision')
    expect(calls[0]!.args.image_url).toBe('https://cdn/in.png')
  })

  it('generate edit calls images_generate with references', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    await adapter.generate({
      kind: 'edit',
      prompt: 'make it night',
      references: [{ url: 'https://cdn/ref.png' }],
    })
    expect(calls[0]!.name).toBe('images_generate')
    expect(calls[0]!.args.references).toEqual(['https://cdn/ref.png'])
  })

  it('maps video, audio, and 3d to the spec tools', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    await adapter.generate({ kind: 'video', prompt: 'waves' })
    await adapter.generate({ kind: 'audio', prompt: 'hello' })
    await adapter.generate({ kind: '3d', prompt: 'a chair' })
    expect(calls.map((c) => c.name)).toEqual(['video_generate', 'audio_tts', 'models3d_generate'])
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

  it('status polls creation_status', async () => {
    const { adapter, calls } = setup({
      callTool: async (_id, name) => {
        if (name === 'creation_status') {
          return textResult('{"task_id":"t1","status":"COMPLETED","url":"https://cdn/done.png"}')
        }
        return textResult(COMPLETED_TEXT)
      },
    })
    await adapter.connect()
    const patch = await adapter.status('t1')
    expect(calls.some((c) => c.name === 'creation_status' && c.args.task_id === 't1')).toBe(true)
    expect(patch.status).toBe('completed')
    expect(patch.resultUrls).toEqual(['https://cdn/done.png'])
  })

  it('catalog calls images_models_list / video_models_list', async () => {
    const { adapter, calls } = setup({
      callTool: async (_id, name) => {
        if (name === 'images_models_list') {
          return { jsonrpc: '2.0', id: 1, result: { models: [{ id: 'flux', label: 'Flux' }] } }
        }
        if (name === 'video_models_list') {
          return { jsonrpc: '2.0', id: 1, result: { models: [{ id: 'kling', name: 'Kling' }] } }
        }
        return textResult(COMPLETED_TEXT)
      },
    })
    await adapter.connect()
    const all = await adapter.catalog()
    expect(calls.map((c) => c.name)).toEqual(['images_models_list', 'video_models_list'])
    expect(all).toEqual([
      { id: 'flux', label: 'Flux', kind: 'image', providerId: 'magnific' },
      { id: 'kling', label: 'Kling', kind: 'video', providerId: 'magnific' },
    ])
    const images = await adapter.catalog('image')
    expect(images).toHaveLength(1)
    expect(images[0]!.id).toBe('flux')
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
    expect(bal).toMatchObject({ providerId: 'magnific', credits: 42, unit: 'credits' })
  })
})

describe('magnificManifest.onStart', () => {
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
    await expect(magnificManifest.onStart?.(ctx as any)).resolves.toBeUndefined()
    expect(registered).toHaveLength(1)
    expect(registered[0]!.id).toBe('magnific')
    expect(warnings.some((w) => /Magnific/i.test(w))).toBe(true)
  })
})
