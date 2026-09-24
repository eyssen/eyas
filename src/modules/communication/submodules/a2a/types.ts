// Part of eYssen. See LICENSE file for full copyright and licensing details.

// ─── Agent Card ──────────────────────────────────────────────────────────────

export interface AgentCardCapabilities {
  streaming: boolean
  pushNotifications: boolean
}

export interface AgentCardSkill {
  id: string
  name: string
  description: string
}

export interface AgentCardAuthentication {
  schemes: string[]
}

export interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  capabilities: AgentCardCapabilities
  skills: AgentCardSkill[]
  authentication: AgentCardAuthentication
}

// ─── A2A Task ────────────────────────────────────────────────────────────────

export type A2ATaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface A2ATask {
  id: string
  status: A2ATaskStatus
  description: string
  result?: string
  error?: string
  createdAt: string
  completedAt?: string
}

// ─── JSON-RPC ────────────────────────────────────────────────────────────────

export interface A2ARequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params: Record<string, unknown>
}

export interface A2AError {
  code: number
  message: string
}

export interface A2AResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: A2AError
}

// ─── JSON-RPC Error Codes ────────────────────────────────────────────────────

export const A2A_ERRORS = {
  PARSE_ERROR: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid Request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error' },
  TASK_NOT_FOUND: { code: -32001, message: 'Task not found' },
  TASK_NOT_CANCELLABLE: { code: -32002, message: 'Task cannot be cancelled' },
} as const
