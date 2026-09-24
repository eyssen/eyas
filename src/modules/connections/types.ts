// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** How the connection is realized at runtime. */
export type ConnectionAdapter = 'mcp' | 'native' | 'http' | 'channel'

/** Lifecycle status of a named connection. */
export type ConnectionStatus =
  | 'pending'      // proposed by agent, awaiting human approval
  | 'disabled'     // intentionally off
  | 'connected'    // last health check OK
  | 'error'        // last health check failed
  | 'unknown'      // never tested or secrets incomplete

/** Who created the connection record. */
export type ConnectionSource = 'user' | 'agent' | 'system'

/** Catalog entry describing a known external system type. */
export interface ConnectionSystemType {
  id: string
  name: string
  description: string
  adapter: ConnectionAdapter
  category: string
  icon: string
  /** Non-secret config fields (baseUrl, org, db, …). */
  configFields: ConnectionFieldDef[]
  /** Secret vault key templates (system scope). Use `{id}` for per-connection names. */
  secretFields: ConnectionFieldDef[]
  /** Optional skill name this system type pairs with. */
  skillName?: string
  /** Native module id when adapter is native (e.g. odoo). */
  nativeModuleId?: string
  setupIntro?: string
  setupSteps?: string[]
  tags?: string[]
}

export interface ConnectionFieldDef {
  name: string
  label: string
  required: boolean
  sensitive?: boolean
  placeholder?: string
  hint?: string
}

/** Scope: which agents / projects may use this connection. */
export interface ConnectionScope {
  /** When true, all agents may use it (subject to tool CASL). */
  default?: boolean
  agentIds?: string[]
  projectIds?: string[]
}

export interface ConnectionHealth {
  lastCheckedAt: string | null
  lastOkAt: string | null
  lastError: string | null
}

export interface Connection {
  id: string
  name: string
  systemType: string
  adapter: ConnectionAdapter
  /** Non-secret config (urls, org slugs, mcp server id, …). */
  config: Record<string, unknown>
  /** Secret names in the vault (system scope) — never values. */
  secretRefs: string[]
  status: ConnectionStatus
  health: ConnectionHealth
  scope: ConnectionScope
  source: ConnectionSource
  /** Approval id when pending (autonomy queue), if any. */
  approvalId: number | null
  reason: string | null
  createdBy: string | null
  approvedAt: string | null
  approvedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateConnectionInput {
  name: string
  systemType: string
  adapter?: ConnectionAdapter
  config?: Record<string, unknown>
  /** Secret names already in vault, or to be filled via secrets map. */
  secretRefs?: string[]
  /**
   * Optional plain secrets to store under system scope.
   * Keys become vault names (or mapped via catalog field names).
   * Values are NEVER persisted on the connection row.
   */
  secrets?: Record<string, string>
  scope?: ConnectionScope
  source?: ConnectionSource
  reason?: string
  createdBy?: string
  /**
   * When true (agent propose), start as `pending` until approve().
   * User/UI creates default to enabled (unknown until first test).
   */
  pending?: boolean
}

export interface UpdateConnectionInput {
  name?: string
  config?: Record<string, unknown>
  secretRefs?: string[]
  secrets?: Record<string, string>
  scope?: ConnectionScope
  status?: ConnectionStatus
  reason?: string
}

export interface ListConnectionsFilter {
  systemType?: string
  status?: ConnectionStatus
  agentId?: string
  projectId?: string
  /** When true, include pending proposals. Default true for UI, false for agent tools. */
  includePending?: boolean
}

export interface ConnectionTestResult {
  ok: boolean
  status: ConnectionStatus
  message?: string
  details?: Record<string, unknown>
}
