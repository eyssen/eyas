// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface ToolInfo {
  id: string
  name: string
  type: 'cli' | 'app'
  path: string
  version?: string
  capabilities: string[]
}

export interface HandCapabilities {
  handId: string
  name: string
  platform: string
  arch: string
  osVersion: string
  protocolVersion: string
  capabilities: {
    cli: boolean
    osAutomation: boolean
    computerUse: boolean
  }
  discoveredTools: ToolInfo[]
}

export interface ConnectedHand extends HandCapabilities {
  connectedAt: Date
  lastSeen: Date
  transportType: 'ws' | 'mcp'
  ws?: any
  mcpTransport?: import('../communication/submodules/mcp-client/types.js').McpTransport
  userId?: string
}

/** Configuration for connecting to a Hand that exposes an MCP server */
export interface McpHandConfig {
  handId: string
  name: string
  platform: string
  transport: 'stdio' | 'http'
  command?: string    // stdio
  args?: string[]     // stdio
  url?: string        // http
}

export interface HandToken {
  id: string
  handId: string
  userId: string
  name: string
  platform: string
  token: string
  createdAt: string
  lastUsed?: string
}
