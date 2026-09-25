// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Where the privacy policy lives: one row in privacy_policy. privacy.yaml is
// the seed — it is (re-)imported whenever its content changes, until the
// first save from the UI. From then on the stored row is authoritative and a
// YAML edit is ignored with a warning. A missing or invalid YAML never
// silently resets the policy: the last good policy stays (the built-in
// defaults on a first boot), the error is logged with the resolved path and
// recorded as seed_error for the UI.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import {
  BUILT_IN_DEFAULTS,
  PrivacyPolicySchema,
  PrivacyPolicyValidationError,
  parsePolicyYaml,
  policyJson,
  type PrivacyPolicy,
} from './policy.js'

export type PolicySource = 'yaml' | 'ui' | 'defaults'

export interface StoredPolicy {
  policy: PrivacyPolicy
  /** Increments whenever the effective policy changes. */
  version: number
  source: PolicySource
  /** sha256 of the privacy.yaml content last imported (or last seen, once UI-managed). */
  yamlHash: string | null
  /** Why the last YAML import failed; null when it succeeded. */
  seedError: string | null
  updatedAt: string
}

export interface PolicyStore {
  readonly yamlPath: string
  current(): StoredPolicy
  /**
   * Re-imports privacy.yaml when its content changed and the policy is not
   * UI-managed. Returns true when the effective policy changed.
   */
  syncFromYaml(): boolean
  /** Persists a validated policy as UI-managed; bumps the version. */
  save(policy: PrivacyPolicy, source: 'ui'): StoredPolicy
}

const ROW_ID = 'default'

export function createPrivacyPolicyTable(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS privacy_policy (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    version INTEGER NOT NULL,
    source TEXT NOT NULL,
    yaml_hash TEXT,
    seed_error TEXT,
    updated_at TEXT NOT NULL
  )`)
}

interface PolicyRow {
  json: string
  version: number
  source: string
  yaml_hash: string | null
  seed_error: string | null
  updated_at: string
}

export interface PolicyStoreOptions {
  db: EyasDb
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  /** Absolute path of privacy.yaml; logged as-is on every error. */
  yamlPath: string
  /** Clock seam for tests. */
  now?: () => Date
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function isSource(value: string): value is PolicySource {
  return value === 'yaml' || value === 'ui' || value === 'defaults'
}

/** Builds the store and performs the boot-time YAML sync. */
export function createPolicyStore(options: PolicyStoreOptions): PolicyStore {
  const { db, logger, yamlPath } = options
  const now = () => (options.now ?? (() => new Date()))().toISOString()

  function readRow(): StoredPolicy | null {
    // all()[0], not get(): drizzle's bun:sqlite get() on raw SQL yields a
    // value array rather than a keyed row.
    const row = db.all<PolicyRow>(
      sql`SELECT json, version, source, yaml_hash, seed_error, updated_at FROM privacy_policy WHERE id = ${ROW_ID}`,
    )[0]
    if (!row) return null
    let policy: PrivacyPolicy
    try {
      policy = PrivacyPolicySchema.parse(JSON.parse(row.json))
    } catch (err) {
      // A row this build cannot read (hand-edited, or written by a newer
      // build) must not take privacy down: fall back to the defaults loudly.
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Privacy: the stored policy is unreadable — using the built-in defaults until it is saved again',
      )
      policy = PrivacyPolicySchema.parse(BUILT_IN_DEFAULTS)
    }
    return {
      policy,
      version: Number(row.version) || 0,
      source: isSource(row.source) ? row.source : 'defaults',
      yamlHash: row.yaml_hash,
      seedError: row.seed_error,
      updatedAt: row.updated_at,
    }
  }

  function writeRow(next: StoredPolicy): StoredPolicy {
    const json = policyJson(next.policy)
    db.run(sql`INSERT INTO privacy_policy (id, json, version, source, yaml_hash, seed_error, updated_at)
      VALUES (${ROW_ID}, ${json}, ${next.version}, ${next.source}, ${next.yamlHash}, ${next.seedError}, ${next.updatedAt})
      ON CONFLICT(id) DO UPDATE SET json = excluded.json, version = excluded.version, source = excluded.source,
        yaml_hash = excluded.yaml_hash, seed_error = excluded.seed_error, updated_at = excluded.updated_at`)
    cached = next
    return next
  }

  let cached: StoredPolicy | null = readRow()

  function recordSeedError(message: string, detail: Record<string, unknown>): boolean {
    logger.error(
      { path: yamlPath, error: message, ...detail },
      cached
        ? 'Privacy: privacy.yaml is missing or invalid — keeping the last good policy'
        : 'Privacy: privacy.yaml is missing or invalid — using the built-in defaults',
    )
    if (!cached) {
      writeRow({
        policy: PrivacyPolicySchema.parse(BUILT_IN_DEFAULTS),
        version: 1,
        source: 'defaults',
        yamlHash: null,
        seedError: message,
        updatedAt: now(),
      })
      return true
    }
    // The broken file's hash is deliberately not recorded: restoring the
    // previous content then clears the error without a version bump.
    if (cached.seedError !== message) writeRow({ ...cached, seedError: message, updatedAt: now() })
    return false
  }

  function syncFromYaml(): boolean {
    let raw: string
    try {
      raw = readFileSync(yamlPath, 'utf-8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      return recordSeedError(
        code === 'ENOENT' ? `privacy.yaml not found at ${yamlPath}` : `cannot read ${yamlPath}: ${(err as Error).message}`,
        {},
      )
    }
    const hash = sha256(raw)

    if (cached?.source === 'ui') {
      if (cached.yamlHash !== hash) {
        logger.warn(
          { path: yamlPath },
          'Privacy: privacy.yaml changed, but the policy is managed in Privacy → Policy — the file is ignored',
        )
        writeRow({ ...cached, yamlHash: hash })
      }
      return false
    }
    if (cached && cached.yamlHash === hash && !cached.seedError) return false

    let parsed: ReturnType<typeof parsePolicyYaml>
    try {
      parsed = parsePolicyYaml(raw)
    } catch (err) {
      if (err instanceof PrivacyPolicyValidationError) {
        return recordSeedError(err.message, { issues: err.issues })
      }
      return recordSeedError(err instanceof Error ? err.message : String(err), {})
    }
    for (const warning of parsed.warnings) logger.warn({ path: yamlPath }, `Privacy: ${warning}`)

    const policyChanged = !cached || policyJson(cached.policy) !== policyJson(parsed.policy)
    writeRow({
      policy: parsed.policy,
      version: policyChanged ? (cached?.version ?? 0) + 1 : cached!.version,
      source: 'yaml',
      yamlHash: hash,
      seedError: null,
      updatedAt: now(),
    })
    if (policyChanged) {
      logger.info({ path: yamlPath, format: parsed.format, version: cached!.version }, 'Privacy: policy imported from privacy.yaml')
    }
    return policyChanged
  }

  syncFromYaml()

  return {
    yamlPath,
    current: () => cached!,
    syncFromYaml,
    save(policy, source) {
      const validated = PrivacyPolicySchema.parse(policy)
      const prev = cached!
      return writeRow({
        policy: validated,
        version: prev.version + 1,
        source,
        yamlHash: prev.yamlHash,
        seedError: null,
        updatedAt: now(),
      })
    },
  }
}
