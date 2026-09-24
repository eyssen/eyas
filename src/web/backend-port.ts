import { existsSync, readFileSync } from 'fs'
import { parse as parseYaml } from 'yaml'

/**
 * Backend listen port used by the Vite dev proxy (`/api`, `/ws`) so the dev
 * frontend follows the same port the backend derives from config/default.yaml.
 * Kept as a tiny, backend-core-free helper so the frontend build stays isolated.
 */
// Keep in sync with src/core/config/defaults.ts (DEFAULT_SERVER_PORT).
// Duplicated here so the Vite config does not import backend-core modules.
const FALLBACK_PORT = 3100

/** Extract `server.port` from default.yaml text. Falls back to DEFAULT_SERVER_PORT. */
export function parseBackendPort(yamlText: string): number {
  const parsed = (parseYaml(yamlText) ?? {}) as { server?: { port?: number } }
  return parsed.server?.port ?? FALLBACK_PORT
}

/** Read the backend listen port from a config yaml file. Falls back to DEFAULT_SERVER_PORT. */
export function readBackendPort(cfgPath: string): number {
  if (!existsSync(cfgPath)) return FALLBACK_PORT
  return parseBackendPort(readFileSync(cfgPath, 'utf-8'))
}
