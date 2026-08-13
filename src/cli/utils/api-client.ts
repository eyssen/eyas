// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { resolveInstance } from '../../core/instance.js'
import { loadResolvedConfig, resolveServerBaseUrl } from '../../core/config/loader.js'
import { DEFAULT_SERVER_PORT } from '../../core/config/defaults.js'

const FALLBACK_BASE_URL = `http://127.0.0.1:${DEFAULT_SERVER_PORT}`

/** Resolve the local server base URL from instance config / env. */
export function defaultBaseUrl(): string {
  try {
    const instance = resolveInstance({ ensureDirs: false })
    const config = loadResolvedConfig({
      configPath: instance.configPath,
      localConfigPath: instance.localConfigPath,
      instance,
    })
    return resolveServerBaseUrl(config)
  } catch {
    return FALLBACK_BASE_URL
  }
}

export async function apiGet(path: string, baseUrl = defaultBaseUrl()): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`)
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function apiPost(path: string, body?: unknown, baseUrl = defaultBaseUrl()): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json()
}
