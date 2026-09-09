// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { createHeygenAdapter, HEYGEN_MCP_URL } from '@modules/media/submodules/heygen/adapter'
import { heygenManifest } from '@modules/media/submodules/heygen/manifest'
import type { McpClient } from '@modules/communication/submodules/mcp-client/client.js'
import type { McpServerInput, McpServerRecord } from '@modules/communication/submodules/mcp-client/types.js'
import type { JsonRpcResponse } from '@modules/communication/submodules/mcp-client/types.js'
import type { MediaProvider } from '@modules/media/types'
import fixture from './fixtures/heygen-tools.json' with { type: 'json' }

const SESSION_TEXT = '{"data":{"session_id":"sess_abc","status":"generating","video_id":null}}'

type Call = { serverId: string; name: string; args: Record<string, unknown> }

function row(over: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'sid-1',
    name: 'heygen',
    transport: 'sse',
    url: HEYGEN_MCP_URL,
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
      return textResult(SESSION_TEXT)
    },
  }

  const secrets = {
    get: async (name: string) => vault[name] ?? null,
  }

  const adapter = createHeygenAdapter({
    mcp,
    secrets,
    logger: pino({ enabled: false }),
  })

  return { adapter, mcp, servers, calls, added, connected, vault, secrets }
}

describe('HeyGen adapter fixture', () => {
  it('lists v1 MCP tool names', () => {
    expect(fixture.map((t) => t.name)).toEqual([
      'create_video_agent',
      'get_video_agent_session',
      'stop_video_agent_session',
      'create_video',
      'get_video',
      'create_speech',
      'list_avatar_looks',
      'list_voices',
      'get_current_user',
    ])
  })
})

describe('createHeygenAdapter', () => {
  it('has id heygen and video+audio capabilities', () => {
    const { adapter } = setup()
    expect(adapter.id).toBe('heygen')
    expect(adapter.name).toBe('HeyGen')
    expect([...adapter.capabilities]).toEqual(['video', 'audio'])
    expect(adapter.configured).toBe(false)
  })

  it('connect find-or-adds the HeyGen MCP server then connects', async () => {
    const { adapter, added, connected, servers } = setup()
    await adapter.connect()
    expect(added).toEqual([
      {
        name: 'heygen',
        transport: 'sse',
        url: HEYGEN_MCP_URL,
        authType: 'oauth',
        ownedBy: 'media',
        autoStart: true,
      },
    ])
    expect(connected).toEqual(['sid-new'])
    expect(servers[0]!.status).toBe('connected')
    expect(adapter.configured).toBe(true)
  })

  it('connect reuses an existing heygen row and does not add again', async () => {
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

  it('generate video without avatar_id calls create_video_agent and unwraps data.session_id', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    const job = await adapter.generate({ kind: 'video', prompt: 'a 30s product intro' })
    expect(calls[0]!.name).toBe('create_video_agent')
    expect(calls[0]!.args).toEqual({ prompt: 'a 30s product intro' })
    expect(job.providerId).toBe('heygen')
    expect(job.providerJobId).toBe('sess_abc')
    expect(job.status).toBe('running')
    expect(job.resultUrls).toEqual([])
    expect(job.completedAt).toBeNull()
  })

  it('generate video with avatar_id calls create_video with script', async () => {
    const { adapter, calls } = setup({
      callTool: async () => ({
        jsonrpc: '2.0',
        id: 1,
        result: { data: { video_id: 'v_1', status: 'pending' } },
      }),
    })
    await adapter.connect()
    const job = await adapter.generate({
      kind: 'video',
      prompt: 'Welcome to EYAS.',
      options: { avatar_id: 'look_9', voice_id: 'en-US-1', engine: 'avatar_v' },
    })
    expect(calls[0]!.name).toBe('create_video')
    expect(calls[0]!.args).toEqual({
      type: 'avatar',
      avatar_id: 'look_9',
      script: 'Welcome to EYAS.',
      voice_id: 'en-US-1',
      engine: 'avatar_v',
    })
    expect(job.providerJobId).toBe('v_1')
    expect(job.status).toBe('queued')
  })

  it('generate video with catalog model uses create_video', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    await adapter.generate({ kind: 'video', prompt: 'hello', model: 'look_from_catalog' })
    expect(calls[0]!.name).toBe('create_video')
    expect(calls[0]!.args.avatar_id).toBe('look_from_catalog')
  })

  it('generate audio calls create_speech', async () => {
    const { adapter, calls } = setup({
      callTool: async () => textResult('{"audio_url":"https://cdn/hey.mp3","status":"completed"}'),
    })
    await adapter.connect()
    const job = await adapter.generate({
      kind: 'audio',
      prompt: 'Hello there',
      options: { voice_id: 'voice_1' },
    })
    expect(calls[0]!.name).toBe('create_speech')
    expect(calls[0]!.args).toEqual({ text: 'Hello there', voice_id: 'voice_1' })
    expect(job.status).toBe('completed')
    expect(job.resultUrls).toEqual(['https://cdn/hey.mp3'])
  })

  it('rejects unsupported kinds', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    const job = await adapter.generate({ kind: 'image', prompt: 'a lamp' })
    expect(calls).toEqual([])
    expect(job.status).toBe('failed')
    expect(job.error).toMatch(/does not support kind image/)
  })

  it('does not pass Magnific upscale mode to Video Agent', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    await adapter.generate({ kind: 'video', prompt: 'hi', options: { mode: 'precision' } })
    expect(calls[0]!.args.mode).toBeUndefined()
  })

  it('status on a session polls get_video_agent_session then get_video', async () => {
    const { adapter, calls } = setup({
      callTool: async (_id, name) => {
        if (name === 'get_video_agent_session') {
          return textResult('{"data":{"session_id":"sess_abc","status":"completed","video_id":"v_9"}}')
        }
        if (name === 'get_video') {
          return textResult('{"data":{"id":"v_9","status":"completed","video_url":"https://files.heygen.ai/v_9.mp4"}}')
        }
        return textResult(SESSION_TEXT)
      },
    })
    await adapter.connect()
    const patch = await adapter.status('sess_abc')
    expect(calls.map((c) => c.name)).toEqual(['get_video_agent_session', 'get_video'])
    expect(patch.status).toBe('completed')
    expect(patch.resultUrls).toEqual(['https://files.heygen.ai/v_9.mp4'])
  })

  it('status stays running when the session has a video_id but get_video errors', async () => {
    const { adapter } = setup({
      callTool: async (_id, name) => {
        if (name === 'get_video_agent_session') {
          return textResult('{"data":{"session_id":"sess_abc","status":"completed","video_id":"v_9"}}')
        }
        if (name === 'get_video') {
          return { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'not ready' } }
        }
        return textResult(SESSION_TEXT)
      },
    })
    await adapter.connect()
    const patch = await adapter.status('sess_abc')
    expect(patch.status).toBe('running')
    expect(patch.resultUrls).toEqual([])
  })

  it('status on a video id only calls get_video', async () => {
    const { adapter, calls } = setup({
      callTool: async (_id, name) => {
        if (name === 'get_video') {
          return { jsonrpc: '2.0', id: 1, result: { status: 'processing' } }
        }
        return textResult(SESSION_TEXT)
      },
    })
    await adapter.connect()
    const patch = await adapter.status('v_1')
    expect(calls.map((c) => c.name)).toEqual(['get_video'])
    expect(patch.status).toBe('running')
  })

  it('catalog lists avatar looks and voices', async () => {
    const { adapter, calls } = setup({
      callTool: async (_id, name) => {
        if (name === 'list_avatar_looks') {
          return { jsonrpc: '2.0', id: 1, result: { looks: [{ id: 'look_1', name: 'June HD' }] } }
        }
        if (name === 'list_voices') {
          return { jsonrpc: '2.0', id: 1, result: { voices: [{ voice_id: 'en-US-1', name: 'English 1' }] } }
        }
        return textResult(SESSION_TEXT)
      },
    })
    await adapter.connect()
    const all = await adapter.catalog()
    expect(calls.map((c) => c.name)).toEqual(['list_avatar_looks', 'list_voices'])
    expect(all).toEqual([
      { id: 'look_1', label: 'June HD', kind: 'video', providerId: 'heygen' },
      { id: 'en-US-1', label: 'English 1', kind: 'audio', providerId: 'heygen' },
    ])
    const video = await adapter.catalog('video')
    expect(video).toHaveLength(1)
    expect(video[0]!.id).toBe('look_1')
    const image = await adapter.catalog('image')
    expect(image).toEqual([])
  })

  it('balance calls get_current_user', async () => {
    const { adapter, calls } = setup({
      callTool: async (_id, name) => {
        if (name === 'get_current_user') {
          return { jsonrpc: '2.0', id: 1, result: { remaining_credits: 12, unit: 'credits' } }
        }
        return textResult(SESSION_TEXT)
      },
    })
    await adapter.connect()
    const bal = await adapter.balance()
    expect(calls.map((c) => c.name)).toContain('get_current_user')
    expect(bal).toMatchObject({ providerId: 'heygen', credits: 12, unit: 'credits' })
  })

  it('cancel stops a video-agent session', async () => {
    const { adapter, calls } = setup()
    await adapter.connect()
    await adapter.cancel('sess_abc')
    expect(calls.some((c) => c.name === 'stop_video_agent_session' && c.args.session_id === 'sess_abc')).toBe(true)
  })
})

describe('heygenManifest.onStart', () => {
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
    await expect(heygenManifest.onStart?.(ctx as any)).resolves.toBeUndefined()
    expect(registered).toHaveLength(1)
    expect(registered[0]!.id).toBe('heygen')
    expect(warnings.some((w) => /HeyGen/i.test(w))).toBe(true)
  })
})
