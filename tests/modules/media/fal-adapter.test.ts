// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { createFalAdapter } from '@modules/media/submodules/fal/adapter'
import { falManifest } from '@modules/media/submodules/fal/manifest'
import type { McpClient } from '@modules/communication/submodules/mcp-client/client.js'
import type { McpServerInput, McpServerRecord } from '@modules/communication/submodules/mcp-client/types.js'
import type { JsonRpcResponse } from '@modules/communication/submodules/mcp-client/types.js'
import type { MediaProvider } from '@modules/media/types'
import fixture from './fixtures/fal-tools.json' with { type: 'json' }

const COMPLETED_TEXT = '{"request_id":"r1","status":"COMPLETED","url":"https://cdn/x.png"}'
const SECRET_REQUESTER = { userId: 'system', role: 'owner', trusted: true } as const

type Call = { serverId: string; name: string; args: Record<string, unknown> }
type UpdateCall = { id: string; input: Partial<McpServerInput> }
type SecretGet = { name: string; scope: string; requester: unknown }

function row(over: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'sid-1',
    name: 'fal',
    transport: 'sse',
    url: 'https://mcp.fal.ai/mcp',
    command: null,
    args: null,
    env: null,
    apiKey: null,
    headers: null,
    authType: 'bearer',
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
  const updated: UpdateCall[] = []
  const connected: string[] = []
  const secretGets: SecretGet[] = []
  const vault = { ...(opts?.secrets ?? { 'fal-api-key': 'fk_test' }) }

  const mcp: Pick<McpClient, 'callTool' | 'list' | 'add' | 'connect' | 'disconnect' | 'get' | 'update'> = {
    list: () => servers,
    get: (id) => servers.find((s) => s.id === id) ?? null,
    add: async (input) => {
      added.push(input)
      const rec = row({
        id: 'sid-new',
        name: input.name,
        transport: input.transport,
        url: input.url ?? null,
        apiKey: input.apiKey ?? null,
        authType: input.authType ?? 'bearer',
        ownedBy: input.ownedBy ?? null,
        autoStart: input.autoStart === false ? 0 : 1,
        status: 'disconnected',
      })
      servers.push(rec)
      return rec
    },
    update: async (id, input) => {
      updated.push({ id, input })
      const rec = servers.find((s) => s.id === id)
      if (!rec) return null
      if (input.name !== undefined) rec.name = input.name
      if (input.transport !== undefined) rec.transport = input.transport
      if (input.url !== undefined) rec.url = input.url ?? null
      if (input.apiKey !== undefined) rec.apiKey = input.apiKey ?? null
      if (input.authType !== undefined) rec.authType = input.authType
      if (input.ownedBy !== undefined) rec.ownedBy = input.ownedBy ?? null
      if (input.autoStart !== undefined) rec.autoStart = input.autoStart ? 1 : 0
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

  const adapter = createFalAdapter({
    mcp,
    secrets,
    logger: pino({ enabled: false }),
  })

  return { adapter, mcp, servers, calls, added, updated, connected, vault, secrets, secretGets }
}

describe('fal adapter fixture', () => {
  it('lists spec §11.3 MCP tool names', () => {
    expect(fixture.map((t) => t.name)).toEqual([
      'search_models',
      'get_model_schema',
      'get_pricing',
      'search_docs',
      'run_model',
      'submit_job',
      'check_job',
      'get_job_result',
      'cancel_job',
      'upload_file',
      'recommend_model',
    ])
  })
})

describe('createFalAdapter', () => {
  it('has id fal and all media kinds', () => {
    const { adapter } = setup()
    expect(adapter.id).toBe('fal')
    expect(adapter.name).toBe('fal')
    expect([...adapter.capabilities]).toEqual(['image', 'video', 'audio', 'upscale', 'edit', '3d'])
    expect(adapter.configured).toBe(false)
  })

  it('connect reads fal-api-key (system, trusted) and adds the MCP row with apiKey', async () => {
    const { adapter, added, connected, servers, secretGets } = setup()
    await adapter.connect()
    expect(secretGets).toContainEqual({
      name: 'fal-api-key',
      scope: 'system',
      requester: SECRET_REQUESTER,
    })
    expect(added).toEqual([
      {
        name: 'fal',
        transport: 'sse',
        url: 'https://mcp.fal.ai/mcp',
        authType: 'bearer',
        ownedBy: 'media',
        autoStart: true,
        apiKey: 'fk_test',
      },
    ])
    expect(connected).toEqual(['sid-new'])
    expect(servers[0]!.status).toBe('connected')
    expect(adapter.configured).toBe(true)
  })

  it('connect reuses an existing fal row, updates apiKey, and does not add again', async () => {
    const { adapter, added, updated, connected } = setup({ existing: [row({ id: 'already' })] })
    await adapter.connect()
    expect(added).toEqual([])
    expect(updated).toEqual([
      {
        id: 'already',
        input: {
          name: 'fal',
          transport: 'sse',
          url: 'https://mcp.fal.ai/mcp',
          authType: 'bearer',
          ownedBy: 'media',
          autoStart: true,
          apiKey: 'fk_test',
        },
      },
    ])
    expect(connected).toEqual(['already'])
  })

  it('configured is true when fal-api-key exists even if MCP connect fails', async () => {
    const { adapter } = setup({
      existing: [row({ id: 'sid-1', status: 'disconnected' })],
      secrets: { 'fal-api-key': 'fk_test' },
      connectImpl: async () => {
        throw new Error('bearer handshake pending')
      },
    })
    await expect(adapter.connect()).rejects.toThrow(/bearer handshake pending/)
    expect(adapter.configured).toBe(true)
  })

  it('generate image calls run_model with default endpoint_id fal-ai/flux/dev', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    const job = await adapter.generate({ kind: 'image', prompt: 'a lamp' })
    expect(calls.map((c) => c.name)).toContain('run_model')
    expect(calls[0]!.args.endpoint_id).toBe('fal-ai/flux/dev')
    expect((calls[0]!.args.input as Record<string, unknown>).prompt).toBe('a lamp')
    expect(job.providerId).toBe('fal')
    expect(job.providerJobId).toBe('r1')
    expect(job.status).toBe('completed')
    expect(job.resultUrls).toEqual(['https://cdn/x.png'])
    expect(job.error).toBeNull()
  })

  it('generate image uses req.model as endpoint_id when provided', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    await adapter.generate({ kind: 'image', prompt: 'x', model: 'fal-ai/flux/schnell' })
    expect(calls[0]!.name).toBe('run_model')
    expect(calls[0]!.args.endpoint_id).toBe('fal-ai/flux/schnell')
  })

  it('generate upscale/edit/audio call run_model', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    await adapter.generate({
      kind: 'upscale',
      prompt: 'sharpen',
      model: 'fal-ai/aura-sr',
      references: [{ url: 'https://cdn/in.png' }],
    })
    await adapter.generate({ kind: 'edit', prompt: 'make it night', model: 'fal-ai/flux/dev' })
    await adapter.generate({ kind: 'audio', prompt: 'hello', model: 'fal-ai/stable-audio' })
    expect(calls.map((c) => c.name)).toEqual(['run_model', 'run_model', 'run_model'])
    expect((calls[0]!.args.input as Record<string, unknown>).image_url).toBe('https://cdn/in.png')
  })

  it('generate video and 3d call submit_job', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    await adapter.generate({ kind: 'video', prompt: 'waves', model: 'fal-ai/kling-video/v1' })
    await adapter.generate({ kind: '3d', prompt: 'a chair', model: 'fal-ai/trellis' })
    expect(calls.map((c) => c.name)).toEqual(['submit_job', 'submit_job'])
    expect(calls[0]!.args.endpoint_id).toBe('fal-ai/kling-video/v1')
    expect(calls[1]!.args.endpoint_id).toBe('fal-ai/trellis')
  })

  it('parses a structured result without text content', async () => {
    const { adapter } = setup({
      callTool: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: { request_id: 'r2', status: 'IN_QUEUE' },
      }),
    })
    await adapter.connect()
    const job = await adapter.generate({ kind: 'video', prompt: 'x', model: 'fal-ai/kling-video/v1' })
    expect(job.providerJobId).toBe('r2')
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

  it('status polls check_job then get_job_result', async () => {
    const { adapter, calls } = setup({
      callTool: async (_id, name) => {
        if (name === 'check_job') {
          return textResult('{"request_id":"r1","status":"COMPLETED"}')
        }
        if (name === 'get_job_result') {
          return textResult('{"request_id":"r1","images":[{"url":"https://cdn/done.png"}]}')
        }
        return textResult(COMPLETED_TEXT)
      },
    })
    await adapter.connect()
    const patch = await adapter.status('r1')
    expect(calls.some((c) => c.name === 'check_job' && c.args.request_id === 'r1')).toBe(true)
    expect(calls.some((c) => c.name === 'get_job_result' && c.args.request_id === 'r1')).toBe(true)
    expect(patch.status).toBe('completed')
    expect(patch.resultUrls).toEqual(['https://cdn/done.png'])
  })

  it('catalog calls search_models', async () => {
    const { adapter, calls } = setup({
      callTool: async (_id, name) => {
        if (name === 'search_models') {
          return {
            jsonrpc: '2.0',
            id: 1,
            result: {
              models: [
                { endpoint_id: 'fal-ai/flux/dev', label: 'FLUX.1 [dev]', category: 'image' },
                { id: 'fal-ai/kling-video/v1', name: 'Kling', kind: 'video' },
              ],
            },
          }
        }
        return textResult(COMPLETED_TEXT)
      },
    })
    await adapter.connect()
    const all = await adapter.catalog()
    expect(calls.map((c) => c.name)).toEqual(['search_models'])
    expect(all).toEqual([
      { id: 'fal-ai/flux/dev', label: 'FLUX.1 [dev]', kind: 'image', providerId: 'fal' },
      { id: 'fal-ai/kling-video/v1', label: 'Kling', kind: 'video', providerId: 'fal' },
    ])
    const images = await adapter.catalog('image')
    expect(calls[1]!.args.query).toBe('image')
    expect(images).toHaveLength(1)
    expect(images[0]!.id).toBe('fal-ai/flux/dev')
  })

  it('balance returns null without calling MCP', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    calls.length = 0
    const bal = await adapter.balance()
    expect(bal).toBeNull()
    expect(calls).toEqual([])
  })
})

describe('falManifest.onStart', () => {
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
      secrets: { get: async () => 'fk_test' },
      logger: {
        warn: (_obj: unknown, msg?: string) => { warnings.push(String(msg ?? _obj)) },
        info: () => {},
      },
      media: {
        registerProvider: (p: MediaProvider) => { registered.push(p) },
      },
    }
    await expect(falManifest.onStart?.(ctx as any)).resolves.toBeUndefined()
    expect(registered).toHaveLength(1)
    expect(registered[0]!.id).toBe('fal')
    expect(warnings.some((w) => /fal/i.test(w))).toBe(true)
  })
})
