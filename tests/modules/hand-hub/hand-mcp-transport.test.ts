// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpTransport, JsonRpcResponse } from '@modules/communication/submodules/mcp-client/types'
import { HandRegistry } from '@modules/hand-hub/hand-registry'
import { HandRouter } from '@modules/hand-hub/hand-router'
import { createHandToolExecutor } from '@modules/hand-hub/hand-tools'
import type { McpHandConfig, HandCapabilities } from '@modules/hand-hub/types'

// ─── Mock MCP transport ────────────────────────────────

function createMockTransport(tools: Array<{ name: string; description?: string }> = []): McpTransport {
  let isConnected = false

  return {
    get connected() { return isConnected },

    async connect() {
      isConnected = true
    },

    async disconnect() {
      isConnected = false
    },

    async send(request): Promise<JsonRpcResponse> {
      if (request.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mock-hand' } },
          id: request.id,
        }
      }

      if (request.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          result: {
            tools: tools.map(t => ({
              name: t.name,
              description: t.description ?? `Tool ${t.name}`,
              inputSchema: { type: 'object', properties: {} },
            })),
          },
          id: request.id,
        }
      }

      if (request.method === 'tools/call') {
        const params = request.params as any
        return {
          jsonrpc: '2.0',
          result: {
            content: [{ type: 'text', text: `Executed ${params?.name} with args ${JSON.stringify(params?.arguments)}` }],
          },
          id: request.id,
        }
      }

      return { jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id: request.id }
    },
  }
}

// ─── Mock the transport factories so we don't spawn real processes ───

vi.mock('@modules/communication/submodules/mcp-client/transports/stdio', () => ({
  createStdioTransport: () => createMockTransport([
    { name: 'run_command', description: 'Run a shell command' },
    { name: 'read_file', description: 'Read a file' },
  ]),
}))

vi.mock('@modules/communication/submodules/mcp-client/transports/http', () => ({
  createHttpTransport: () => createMockTransport([
    { name: 'http_tool', description: 'HTTP-based tool' },
  ]),
}))

// Import after mocks
const { createMcpHandManager } = await import('@modules/hand-hub/hand-mcp-transport')

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any

describe('hand-mcp-transport', () => {
  let registry: HandRegistry
  let mcpManager: ReturnType<typeof createMcpHandManager>

  beforeEach(() => {
    registry = new HandRegistry()
    mcpManager = createMcpHandManager({ registry, logger: mockLogger })
    vi.clearAllMocks()
  })

  describe('connectMcpHand', () => {
    it('should connect a stdio MCP Hand and discover tools', async () => {
      const config: McpHandConfig = {
        handId: 'mcp-hand-1',
        name: 'My Mac',
        platform: 'darwin',
        transport: 'stdio',
        command: '/usr/local/bin/eyas-hand',
        args: ['--mcp'],
      }

      const result = await mcpManager.connectMcpHand(config)

      expect(result.handId).toBe('mcp-hand-1')
      expect(result.tools).toHaveLength(2)
      expect(result.tools[0].name).toBe('run_command')
      expect(result.tools[1].name).toBe('read_file')

      // Verify registration in registry
      const hand = registry.getHand('mcp-hand-1')
      expect(hand).toBeDefined()
      expect(hand!.transportType).toBe('mcp')
      expect(hand!.name).toBe('My Mac')
      expect(hand!.platform).toBe('darwin')
      expect(hand!.mcpTransport).toBeDefined()
      expect(hand!.mcpTransport!.connected).toBe(true)
    })

    it('should connect an http MCP Hand', async () => {
      const config: McpHandConfig = {
        handId: 'mcp-hand-2',
        name: 'Remote Server',
        platform: 'linux',
        transport: 'http',
        url: 'http://192.168.1.100:8080/mcp',
      }

      const result = await mcpManager.connectMcpHand(config)

      expect(result.handId).toBe('mcp-hand-2')
      expect(result.tools).toHaveLength(1)
      expect(result.tools[0].name).toBe('http_tool')

      const hand = registry.getHand('mcp-hand-2')
      expect(hand!.transportType).toBe('mcp')
    })

    it('should throw if stdio transport has no command', async () => {
      const config: McpHandConfig = {
        handId: 'bad-hand',
        name: 'Bad',
        platform: 'darwin',
        transport: 'stdio',
        // no command
      }

      await expect(mcpManager.connectMcpHand(config)).rejects.toThrow('stdio transport requires a command')
    })

    it('should throw if http transport has no url', async () => {
      const config: McpHandConfig = {
        handId: 'bad-hand',
        name: 'Bad',
        platform: 'linux',
        transport: 'http',
        // no url
      }

      await expect(mcpManager.connectMcpHand(config)).rejects.toThrow('http transport requires a url')
    })

    it('should disconnect existing Hand before reconnecting', async () => {
      const config: McpHandConfig = {
        handId: 'mcp-hand-reconnect',
        name: 'Mac',
        platform: 'darwin',
        transport: 'stdio',
        command: '/usr/local/bin/eyas-hand',
      }

      await mcpManager.connectMcpHand(config)
      const firstHand = registry.getHand('mcp-hand-reconnect')
      expect(firstHand).toBeDefined()

      // Reconnect
      await mcpManager.connectMcpHand(config)
      const secondHand = registry.getHand('mcp-hand-reconnect')
      expect(secondHand).toBeDefined()
      expect(secondHand!.transportType).toBe('mcp')
    })
  })

  describe('executeMcpTool', () => {
    it('should execute a tool on an MCP Hand', async () => {
      await mcpManager.connectMcpHand({
        handId: 'exec-hand',
        name: 'Exec Mac',
        platform: 'darwin',
        transport: 'stdio',
        command: '/usr/local/bin/eyas-hand',
      })

      const resp = await mcpManager.executeMcpTool('exec-hand', 'run_command', {
        command: 'ls -la',
      })

      expect(resp.error).toBeUndefined()
      expect(resp.result).toBeDefined()
    })

    it('should throw if Hand is not connected', async () => {
      await expect(
        mcpManager.executeMcpTool('nonexistent', 'run_command', {}),
      ).rejects.toThrow('not connected')
    })
  })

  describe('disconnectMcpHand', () => {
    it('should disconnect and unregister an MCP Hand', async () => {
      await mcpManager.connectMcpHand({
        handId: 'disc-hand',
        name: 'Disc Mac',
        platform: 'darwin',
        transport: 'stdio',
        command: '/usr/local/bin/eyas-hand',
      })

      expect(registry.getHand('disc-hand')).toBeDefined()

      await mcpManager.disconnectMcpHand('disc-hand')

      expect(registry.getHand('disc-hand')).toBeUndefined()
      expect(mcpManager.isMcpHand('disc-hand')).toBe(false)
    })

    it('should not throw when disconnecting unknown Hand', async () => {
      await expect(mcpManager.disconnectMcpHand('unknown')).resolves.not.toThrow()
    })
  })

  describe('disconnectAll', () => {
    it('should disconnect all MCP Hands', async () => {
      await mcpManager.connectMcpHand({
        handId: 'hand-a',
        name: 'A',
        platform: 'darwin',
        transport: 'stdio',
        command: '/usr/local/bin/eyas-hand',
      })
      await mcpManager.connectMcpHand({
        handId: 'hand-b',
        name: 'B',
        platform: 'linux',
        transport: 'http',
        url: 'http://localhost:9000/mcp',
      })

      expect(registry.listHands()).toHaveLength(2)

      await mcpManager.disconnectAll()

      expect(registry.listHands()).toHaveLength(0)
      expect(mcpManager.isMcpHand('hand-a')).toBe(false)
      expect(mcpManager.isMcpHand('hand-b')).toBe(false)
    })
  })
})

describe('unified routing (WS + MCP coexistence)', () => {
  let registry: HandRegistry
  let router: HandRouter
  let mcpManager: ReturnType<typeof createMcpHandManager>

  beforeEach(async () => {
    registry = new HandRegistry()
    router = new HandRouter(registry)
    mcpManager = createMcpHandManager({ registry, logger: mockLogger })
    vi.clearAllMocks()
  })

  it('should route to WS Hand by tool', () => {
    const wsCaps: HandCapabilities = {
      handId: 'ws-hand',
      name: 'WS Mac',
      platform: 'darwin',
      arch: 'arm64',
      osVersion: '15.0',
      protocolVersion: '1.0',
      capabilities: { cli: true, osAutomation: true, computerUse: false },
      discoveredTools: [
        { id: 'git', name: 'git', type: 'cli', path: '/usr/bin/git', capabilities: ['cli'] },
      ],
    }
    registry.register('ws-hand', wsCaps, { send: vi.fn() })

    const found = router.findByTool('git')
    expect(found).toBe('ws-hand')
  })

  it('should route to MCP Hand by tool', async () => {
    await mcpManager.connectMcpHand({
      handId: 'mcp-hand',
      name: 'MCP Mac',
      platform: 'darwin',
      transport: 'stdio',
      command: '/usr/local/bin/eyas-hand',
    })

    const found = router.findByTool('mcp:run_command')
    expect(found).toBe('mcp-hand')
  })

  it('should have both WS and MCP Hands in listing', async () => {
    const wsCaps: HandCapabilities = {
      handId: 'ws-hand',
      name: 'WS Mac',
      platform: 'darwin',
      arch: 'arm64',
      osVersion: '15.0',
      protocolVersion: '1.0',
      capabilities: { cli: true, osAutomation: false, computerUse: false },
      discoveredTools: [],
    }
    registry.register('ws-hand', wsCaps, { send: vi.fn() })

    await mcpManager.connectMcpHand({
      handId: 'mcp-hand',
      name: 'MCP Mac',
      platform: 'darwin',
      transport: 'stdio',
      command: '/usr/local/bin/eyas-hand',
    })

    const hands = registry.listHands()
    expect(hands).toHaveLength(2)

    const wsHand = hands.find(h => h.handId === 'ws-hand')
    const mcpHand = hands.find(h => h.handId === 'mcp-hand')

    expect(wsHand!.transportType).toBe('ws')
    expect(mcpHand!.transportType).toBe('mcp')
  })

  it('should execute on correct transport via unified executor', async () => {
    const mockWsSend = vi.fn()
    const wsCaps: HandCapabilities = {
      handId: 'ws-hand',
      name: 'WS Mac',
      platform: 'darwin',
      arch: 'arm64',
      osVersion: '15.0',
      protocolVersion: '1.0',
      capabilities: { cli: true, osAutomation: false, computerUse: false },
      discoveredTools: [
        { id: 'git', name: 'git', type: 'cli', path: '/usr/bin/git', capabilities: ['cli'] },
      ],
    }
    registry.register('ws-hand', wsCaps, { send: mockWsSend })

    await mcpManager.connectMcpHand({
      handId: 'mcp-hand',
      name: 'MCP Mac',
      platform: 'darwin',
      transport: 'stdio',
      command: '/usr/local/bin/eyas-hand',
    })

    const executor = createHandToolExecutor(registry, router, mcpManager)

    // Execute on WS Hand
    const wsResult = await executor({
      targetHandId: 'ws-hand',
      command: 'git status',
    }) as any
    expect(wsResult.transportType).toBe('ws')
    expect(mockWsSend).toHaveBeenCalled()

    // Execute on MCP Hand
    const mcpResult = await executor({
      targetHandId: 'mcp-hand',
      command: 'run_command',
    }) as any
    expect(mcpResult.transportType).toBe('mcp')
    expect(mcpResult.result).toBeDefined()
  })
})
