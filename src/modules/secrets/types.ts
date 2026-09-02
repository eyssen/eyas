// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface SecretMeta {
  id: string
  name: string
  scope: string
  module: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Requester context passed into every registry call that needs authorization.
 * - `userId`: authenticated principal id (user or agent user row)
 * - `role`: 'owner' | 'admin' | 'user' | 'agent' | 'guest'
 * - `isAgent`: true when the principal is an agent (is_agent=1 in users table)
 * - `trusted`: set to true for internal system-initiated reads that must bypass
 *   scope checks (module bootstrap, provider manifests). Defaults to false.
 */
export interface Requester {
  userId: string
  role: string
  isAgent?: boolean
  trusted?: boolean
}

/**
 * Low-level optional audit sink the registry uses to log denied/privileged reads.
 * The `audit` module (or any compatible logger) can supply this. The registry
 * will never invoke this with a secret value — only with metadata (name, scope).
 */
export interface SecretsAuditSink {
  logDenied(input: { userId: string | null; action: string; target: string; details?: unknown }): void
  logPrivileged(input: { userId: string | null; action: string; target: string; details?: unknown }): void
}

export interface SecretsRegistry {
  /**
   * Look up a secret's plaintext.
   *
   * When `requester` is provided the registry enforces scope isolation:
   *  - owner/admin (non-agent) can read any scope
   *  - any other principal can only read matching scopes
   *    (own `user:<id>` or, if isAgent, own `agent:<id>`)
   *  - `trusted: true` bypasses checks for internal system paths
   *
   * When `requester` is omitted the call is treated as a legacy/internal
   * invocation and scope is NOT enforced. This exists solely for backwards
   * compatibility with existing modules that read `system` secrets during
   * bootstrap; new code MUST pass a requester.
   */
  get(name: string, scope: string, requester?: Requester): Promise<string | null>
  set(name: string, scope: string, value: string, module?: string, requester?: Requester): Promise<void>
  delete(name: string, scope: string, requester?: Requester): Promise<boolean>
  /**
   * List secret metadata.
   *
   * If `requester` is provided scope is enforced at the DB query level:
   *  - owner/admin (non-agent) may pass any scope, including `'*'` to list
   *    every scope
   *  - anyone else may only list a scope they own; mismatched scopes raise
   *    a ScopeDeniedError
   */
  list(scope: string, requester?: Requester): Promise<SecretMeta[]>
  has(name: string, scope: string, requester?: Requester): Promise<boolean>
}

/** Thrown by the registry when a requester asks for a scope they cannot access. */
export class ScopeDeniedError extends Error {
  readonly code = 'SCOPE_DENIED'
  constructor(message = 'Access denied to this scope') {
    super(message)
    this.name = 'ScopeDeniedError'
  }
}
