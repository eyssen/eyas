// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { McpTransport, JsonRpcResponse } from '../communication/submodules/mcp-client/types.js'
import { createStdioTransport } from '../communication/submodules/mcp-client/transports/stdio.js'
import { createHttpTransport } from '../communication/submodules/mcp-client/transports/http.js'
import type { HandRegistry } from './hand-registry.js'
import type { McpHandConfig, HandCapabilities, ToolInfo } from './types.js'

/**
 * Manages MCP-connected Hands — connects to a Hand that runs an MCP server,
 * discovers its tools, and registers it in the HandRegistry.
 */
export function createMcpHandManager(deps: {
  registry: HandRegistry
  logger: Logger
}) {
  const { registry, logger } = deps
  const transports = new Map<string, McpTransport>()

  function createTransportForConfig(config: McpHandConfig): McpTransport {
    switch (config.transport) {
      case 'stdio': {
        if (!config.command) {
          throw new Error(`MCP Hand "${config.name}": stdio transport requires a command`)
        }
        return createStdioTransport({
          command: config.command,
          args: config.args ?? [],
        })
      }
      case 'http': {
        if (!config.url) {
          throw new Error(`MCP Hand "${config.name}": http transport requires a url`)
        }
        return createHttpTransport({ url: config.url })
      }
      default:
        throw new Error(`Unknown MCP Hand transport: ${config.transport}`)
    }
  }

  /**
   * Discover tools from an MCP server and map them to Hand ToolInfo format.
   */
  async function discoverTools(transport: McpTransport): Promise<ToolInfo[]> {
    const resp = await transport.send({
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {},
      id: Date.now(),
    })

    if (resp.error) {
      throw new Error(`MCP tools/list failed: ${resp.error.message}`)
    }

    const mcpTools = ((resp.result as any)?.tools ?? []) as Array<{
      name: string
      description?: string
      inputSchema?: Record<string, unknown>
    }>

    return mcpTools.map((t) => ({
      id: `mcp:${t.name}`,
      name: t.name,
      type: 'cli' as const,
      path: `mcp://${t.name}`,
      capabilities: ['mcp'],
    }))
  }

  return {
    /**
     * Connect to a Hand that exposes an MCP server.
     * Creates the transport, connects, discovers tools, and registers in registry.
     */
    async connectMcpHand(config: McpHandConfig, userId?: string): Promise<{
      handId: string
      tools: ToolInfo[]
    }> {
      // Disconnect existing if already connected
      if (transports.has(config.handId)) {
        await this.disconnectMcpHand(config.handId)
      }

      const transport = createTransportForConfig(config)

      try {
        await transport.connect()
      } catch (err: any) {
        logger.error({ handId: config.handId, err: err.message }, 'MCP Hand connect failed')
        throw err
      }

      const tools = await discoverTools(transport)

      const capabilities: HandCapabilities = {
        handId: config.handId,
        name: config.name,
        platform: config.platform,
        arch: 'unknown',
        osVersion: 'unknown',
        protocolVersion: 'mcp-2024-11-05',
        capabilities: {
          cli: true,
          osAutomation: false,
          computerUse: false,
        },
        discoveredTools: tools,
      }

      registry.registerMcp(config.handId, capabilities, transport, userId)
      transports.set(config.handId, transport)

      logger.info(
        { handId: config.handId, name: config.name, tools: tools.length },
        'MCP Hand connected and registered',
      )

      return { handId: config.handId, tools }
    },

    /**
     * Execute a tool on an MCP-connected Hand via tools/call.
     */
    async executeMcpTool(
      handId: string,
      toolName: string,
      args: Record<string, unknown>,
    ): Promise<JsonRpcResponse> {
      const transport = transports.get(handId)
      if (!transport) {
        throw new Error(`MCP Hand "${handId}" is not connected`)
      }
      if (!transport.connected) {
        throw new Error(`MCP Hand "${handId}" transport is not connected`)
      }

      const resp = await transport.send({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: toolName, arguments: args },
        id: Date.now(),
      })

      // Update last seen
      registry.updateLastSeen(handId)

      return resp
    },

    /**
     * Disconnect an MCP Hand and unregister it.
     */
    async disconnectMcpHand(handId: string): Promise<void> {
      const transport = transports.get(handId)
      if (transport) {
        try {
          await transport.disconnect()
        } catch (err: any) {
          logger.warn({ handId, err: err.message }, 'MCP Hand disconnect error')
        }
        transports.delete(handId)
      }
      registry.unregister(handId)
      logger.info({ handId }, 'MCP Hand disconnected')
    },

    /**
     * Check if a Hand is connected via MCP.
     */
    isMcpHand(handId: string): boolean {
      return transports.has(handId)
    },

    /**
     * Get the MCP transport for a Hand (for direct use if needed).
     */
    getTransport(handId: string): McpTransport | undefined {
      return transports.get(handId)
    },

    /**
     * Disconnect all MCP Hands (called on shutdown).
     */
    async disconnectAll(): Promise<void> {
      for (const [handId] of transports) {
        await this.disconnectMcpHand(handId).catch(() => {})
      }
    },
  }
}

export type McpHandManager = ReturnType<typeof createMcpHandManager>
