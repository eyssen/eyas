// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type ConnectionType = 'ssh' | 'websocket' | 'tailscale'
export type NodeStatus = 'online' | 'offline' | 'error'

export interface RemoteNode {
  id: string
  name: string
  host: string
  connectionType: ConnectionType
  capabilities: string[]
  status: NodeStatus
  lastSeen: string | null
  config: Record<string, unknown> | null
  createdAt: string
}

export interface CreateNodeInput {
  name: string
  host: string
  connectionType?: ConnectionType
  capabilities?: string[]
  config?: Record<string, unknown>
}

export interface UpdateNodeInput {
  name?: string
  host?: string
  connectionType?: ConnectionType
  capabilities?: string[]
  status?: NodeStatus
  config?: Record<string, unknown>
}
