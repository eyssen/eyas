// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import { encryptSecret, decryptSecret } from './crypto.js'
import { ScopeDeniedError } from './types.js'
import type { SecretsRegistry, SecretMeta, Requester, SecretsAuditSink } from './types.js'

const PRIVILEGED_ROLES = new Set(['owner', 'admin'])

/**
 * Return the set of scopes a requester is allowed to touch.
 * - owner/admin (non-agent): null = "no restriction"
 * - agent: only its own `agent:<id>` namespace
 * - user: `user:<id>` or `system:read` denied; system requires privileged role
 *
 * Note: `system` is intentionally NOT auto-granted to regular users — only
 * owner/admin may read `system` secrets (which typically hold provider API keys,
 * jwt-secret, etc.). This keeps the blast radius of a compromised user account
 * bounded to the user's own secrets.
 */
function allowedScopesFor(req: Requester): Set<string> | null {
  if (req.trusted) return null
  if (req.isAgent) return new Set([`agent:${req.userId}`])
  if (PRIVILEGED_ROLES.has(req.role)) return null
  return new Set([`user:${req.userId}`])
}

function isScopeAllowed(req: Requester, scope: string): boolean {
  const allowed = allowedScopesFor(req)
  if (allowed === null) return true
  return allowed.has(scope)
}

export function createSecretsRegistry(
  db: any,
  masterKey: CryptoKey,
  audit?: SecretsAuditSink,
): SecretsRegistry {
  function getOne<T>(query: any): T | undefined {
    const rows = db.all(query) as T[]
    return rows[0]
  }

  function deny(req: Requester | undefined, action: string, target: string, scope: string): never {
    if (audit && req) {
      audit.logDenied({
        userId: req.userId,
        action,
        target,
        details: { scope, role: req.role, isAgent: !!req.isAgent },
      })
    }
    throw new ScopeDeniedError()
  }

  function maybeLogPrivileged(req: Requester | undefined, action: string, target: string, scope: string): void {
    if (!audit || !req) return
    // Only emit when a privileged (owner/admin) role reads outside its own namespace,
    // or when a trusted system read happens. Skip the noise for normal per-user reads.
    if (req.trusted || PRIVILEGED_ROLES.has(req.role)) {
      audit.logPrivileged({
        userId: req.userId,
        action,
        target,
        details: { scope, role: req.role, trusted: !!req.trusted },
      })
    }
  }

  return {
    async get(name, scope, requester) {
      if (requester && !isScopeAllowed(requester, scope)) {
        deny(requester, 'secrets.get', name, scope)
      }
      const row = getOne<any>(sql`SELECT * FROM secrets WHERE name = ${name} AND scope = ${scope}`)
      if (!row) return null
      maybeLogPrivileged(requester, 'secrets.get', name, scope)
      return decryptSecret(row.encrypted, row.iv, row.tag, masterKey)
    },

    async set(name, scope, value, module, requester) {
      if (requester && !isScopeAllowed(requester, scope)) {
        deny(requester, 'secrets.set', name, scope)
      }
      const { encrypted, iv, tag } = await encryptSecret(value, masterKey)
      const now = new Date().toISOString()
      const existing = getOne<any>(sql`SELECT id FROM secrets WHERE name = ${name} AND scope = ${scope}`)

      if (existing) {
        db.run(sql`UPDATE secrets SET encrypted = ${encrypted}, iv = ${iv}, tag = ${tag}, module = ${module ?? null}, updated_at = ${now} WHERE id = ${existing.id}`)
      } else {
        const id = generateId()
        db.run(sql`INSERT INTO secrets (id, name, scope, encrypted, iv, tag, module, created_at, updated_at) VALUES (${id}, ${name}, ${scope}, ${encrypted}, ${iv}, ${tag}, ${module ?? null}, ${now}, ${now})`)
      }
      maybeLogPrivileged(requester, 'secrets.set', name, scope)
    },

    async delete(name, scope, requester) {
      if (requester && !isScopeAllowed(requester, scope)) {
        deny(requester, 'secrets.delete', name, scope)
      }
      const existing = getOne<any>(sql`SELECT id FROM secrets WHERE name = ${name} AND scope = ${scope}`)
      if (!existing) return false
      db.run(sql`DELETE FROM secrets WHERE id = ${existing.id}`)
      maybeLogPrivileged(requester, 'secrets.delete', name, scope)
      return true
    },

    async list(scope, requester) {
      // Privileged "list everything" — only for owner/admin (non-agent) or trusted.
      if (scope === '*') {
        if (!requester || (!requester.trusted && (!PRIVILEGED_ROLES.has(requester.role) || requester.isAgent))) {
          deny(requester, 'secrets.list', '*', '*')
        }
        const rows = db.all(sql`SELECT id, name, scope, module, created_at, updated_at FROM secrets ORDER BY scope, name`) as any[]
        maybeLogPrivileged(requester, 'secrets.list', '*', '*')
        return rows.map(mapMeta)
      }

      if (requester && !isScopeAllowed(requester, scope)) {
        deny(requester, 'secrets.list', scope, scope)
      }

      const rows = db.all(
        sql`SELECT id, name, scope, module, created_at, updated_at FROM secrets WHERE scope = ${scope} ORDER BY name`,
      ) as any[]
      maybeLogPrivileged(requester, 'secrets.list', scope, scope)
      return rows.map(mapMeta)
    },

    async has(name, scope, requester) {
      if (requester && !isScopeAllowed(requester, scope)) {
        // has() leaks existence information, so treat it as read: deny on mismatch.
        deny(requester, 'secrets.has', name, scope)
      }
      const row = getOne<any>(sql`SELECT 1 FROM secrets WHERE name = ${name} AND scope = ${scope}`)
      return !!row
    },
  }
}

function mapMeta(r: any): SecretMeta {
  return {
    id: r.id,
    name: r.name,
    scope: r.scope,
    module: r.module,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
