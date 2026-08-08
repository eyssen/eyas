// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readFileSync, existsSync } from 'fs'
import { parse as parseYaml } from 'yaml'
import { isAbsolute, resolve } from 'path'
import { configSchema, defaultConfig } from './schema.js'
import { deepMerge } from './merge.js'
import type { EyasConfig } from '@core/types'
import type { InstancePaths } from '../instance.js'

function readYamlObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, 'utf-8')
  const parsed = parseYaml(raw)
  if (parsed === null || parsed === undefined) return {}
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid config at ${path}: expected a YAML mapping`)
  }
  return parsed as Record<string, unknown>
}

/**
 * Apply environment overrides on top of a parsed config object (pre-Zod).
 *
 * Priority (highest last, applied here after files):
 *   EYAS_HOST, EYAS_PORT, EYAS_DB_PATH
 */
export function applyEnvOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  const server = {
    ...((raw.server as Record<string, unknown> | undefined) ?? {}),
  }
  const database = {
    ...((raw.database as Record<string, unknown> | undefined) ?? {}),
  }

  if (process.env.EYAS_HOST) {
    server.host = process.env.EYAS_HOST
  }
  if (process.env.EYAS_PORT) {
    const port = parseInt(process.env.EYAS_PORT, 10)
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid EYAS_PORT="${process.env.EYAS_PORT}" — expected 1–65535`)
    }
    server.port = port
  }
  if (process.env.EYAS_DB_PATH) {
    database.path = process.env.EYAS_DB_PATH
  }

  return {
    ...raw,
    server,
    database,
  }
}

/**
 * Load a single YAML file and validate (no merge, no env).
 * Used by tests and callers that want a pure file load.
 */
export function loadConfig(path: string): EyasConfig {
  if (!existsSync(path)) {
    return defaultConfig
  }
  const parsed = readYamlObject(path)
  const result = configSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `Invalid config at ${path}: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
    )
  }
  return result.data
}

export interface LoadResolvedConfigOptions {
  /** Primary config path. */
  configPath: string
  /** Optional local overlay (e.g. config/local.yaml). */
  localConfigPath?: string | null
  /** When set, relative database.path is resolved under instance.dataDir. */
  instance?: Pick<InstancePaths, 'dataDir' | 'databasePath' | 'home'>
  /** Apply EYAS_HOST / EYAS_PORT / EYAS_DB_PATH (default true). */
  applyEnv?: boolean
}

/**
 * Full config resolution: primary YAML → local.yaml merge → env overrides → Zod.
 * Relative `database.path` values are resolved against the instance data dir when
 * an instance is provided (so EYAS_HOME multi-instance keeps separate DBs).
 */
export function loadResolvedConfig(options: LoadResolvedConfigOptions): EyasConfig {
  const { configPath, localConfigPath, instance, applyEnv = true } = options

  let raw: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    raw = readYamlObject(configPath)
  }

  if (localConfigPath && existsSync(localConfigPath)) {
    raw = deepMerge(raw, readYamlObject(localConfigPath))
  }

  if (applyEnv) {
    raw = applyEnvOverrides(raw)
  }

  // Instance-aware database path: default or relative under dataDir
  if (instance) {
    const db = { ...((raw.database as Record<string, unknown> | undefined) ?? {}) }
    const configured = typeof db.path === 'string' ? db.path : undefined
    if (!configured) {
      db.path = instance.databasePath
    } else if (!isAbsolute(configured)) {
      // Treat paths like "data/sqlite/eyas.db" as relative to instance home
      db.path = resolve(instance.home, configured)
    }
    raw = { ...raw, database: db }
  }

  const result = configSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(
      `Invalid config: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
    )
  }
  return result.data
}

/** Base URL for CLI clients talking to a local server. */
export function resolveServerBaseUrl(config: Pick<EyasConfig, 'server'>, hostOverride?: string): string {
  const host = hostOverride
    ?? (config.server.host === '0.0.0.0' || config.server.host === '::' ? '127.0.0.1' : config.server.host)
  return `http://${host}:${config.server.port}`
}
