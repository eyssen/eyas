// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** MCP transport types */
export type McpTransportType = 'stdio' | 'http' | 'sse'

/** MCP server connection status */
export type McpServerStatus = 'connected' | 'disconnected' | 'error' | 'connecting'

/** How the client authenticates to a remote MCP server */
export type McpAuthType = 'none' | 'bearer' | 'oauth'

/** Persisted MCP server configuration */
export interface McpServerRecord {
  id: string
  name: string
  transport: McpTransportType
  url: string | null          // HTTP/SSE endpoint
  command: string | null      // stdio: executable to spawn
  args: string | null         // stdio: JSON array of args
  env: string | null          // stdio: JSON object of env vars
  apiKey: string | null       // auth token for HTTP/SSE
  headers: string | null      // extra HTTP headers (JSON object)
  authType: string            // column auth_type; 'none' | 'bearer' | 'oauth'
  ownedBy: string | null      // column owned_by
  enabled: number
  autoStart: number
  discoveredTools: string | null      // cached JSON
  discoveredResources: string | null  // cached JSON
  discoveredPrompts: string | null    // cached JSON
  status: string
  error: string | null
  createdAt: string
  updatedAt: string
}

/** API-facing MCP server config (for create/update) */
export interface McpServerInput {
  name: string
  transport: McpTransportType
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  apiKey?: string
  headers?: Record<string, string>
  authType?: McpAuthType
  ownedBy?: string
  enabled?: boolean
  autoStart?: boolean
}

/** Discovered MCP tool */
export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** Discovered MCP resource */
export interface McpResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

/** Discovered MCP prompt template */
export interface McpPrompt {
  name: string
  description?: string
  arguments?: Array<{
    name: string
    description?: string
    required?: boolean
  }>
}

/** JSON-RPC request */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
  id: number | string
}

/** JSON-RPC response */
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
  id: number | string | null
}

/** Transport interface — all transports must implement this */
export interface McpTransport {
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(request: JsonRpcRequest, opts?: { timeoutMs?: number }): Promise<JsonRpcResponse>
  readonly connected: boolean
  readonly sessionId?: string | null
}

/** Config file MCP server entry */
export interface McpConfigEntry {
  name: string
  transport: McpTransportType
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  apiKey?: string
  headers?: Record<string, string>
  authType?: McpAuthType
  ownedBy?: string
  enabled?: boolean
}
