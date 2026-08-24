// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { sanitizeTunnelToken } from './tunnel-token.js'
import { normalizePublicHostname } from './providers/cloudflare.js'

export const INGRESS_SETTINGS_PATH = join('data', 'ingress', 'settings.json')
export const INGRESS_TOKEN_SECRET = 'ingress-cloudflare-token'

export interface IngressSavedSettings {
  hostname: string
}

const EMPTY: IngressSavedSettings = { hostname: '' }

export function loadIngressSettings(): IngressSavedSettings {
  try {
    if (!existsSync(INGRESS_SETTINGS_PATH)) return { ...EMPTY }
    const raw = JSON.parse(readFileSync(INGRESS_SETTINGS_PATH, 'utf-8')) as Partial<IngressSavedSettings>
    const rawHost = typeof raw.hostname === 'string' ? raw.hostname.trim() : ''
    let hostname = rawHost
    try {
      hostname = normalizePublicHostname(rawHost) ?? ''
    } catch {
      hostname = rawHost
    }
    return { hostname }
  } catch {
    return { ...EMPTY }
  }
}

export function saveIngressSettings(settings: IngressSavedSettings): IngressSavedSettings {
  const next: IngressSavedSettings = {
    hostname: normalizePublicHostname(settings.hostname) ?? '',
  }
  mkdirSync(dirname(INGRESS_SETTINGS_PATH), { recursive: true })
  writeFileSync(INGRESS_SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export async function resolveIngressCredentials(
  incoming: { token?: string; hostname?: string },
  getSecret?: (key: string) => Promise<string | null>,
): Promise<{ token: string; hostname: string }> {
  const saved = loadIngressSettings()
  const incomingToken = sanitizeTunnelToken(incoming.token ?? '')
  const storedToken = getSecret ? sanitizeTunnelToken((await getSecret(INGRESS_TOKEN_SECRET)) ?? '') : ''
  const token = incomingToken || storedToken
  const hostname = incoming.hostname?.trim() || saved.hostname
  return { token, hostname }
}
