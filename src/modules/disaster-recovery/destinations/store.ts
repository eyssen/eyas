// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { DestinationConfig, DestinationStoreFile } from './types.js'
import { EMPTY_STORE } from './types.js'

const STORE_PATH = join('data', 'backups', 'destinations.json')

export function loadDestinationStore(): DestinationStoreFile {
  try {
    if (!existsSync(STORE_PATH)) return { ...EMPTY_STORE, destinations: [] }
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf-8')) as DestinationStoreFile
    return {
      primaryDestinationId: raw.primaryDestinationId ?? null,
      destinations: Array.isArray(raw.destinations) ? raw.destinations : [],
    }
  } catch {
    return { ...EMPTY_STORE, destinations: [] }
  }
}

export function saveDestinationStore(store: DestinationStoreFile): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true })
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
}

export function upsertDestination(dest: DestinationConfig): DestinationStoreFile {
  const store = loadDestinationStore()
  const idx = store.destinations.findIndex((d) => d.id === dest.id)
  if (idx >= 0) store.destinations[idx] = dest
  else store.destinations.push(dest)
  saveDestinationStore(store)
  return store
}

export function removeDestination(id: string): DestinationStoreFile {
  const store = loadDestinationStore()
  store.destinations = store.destinations.filter((d) => d.id !== id)
  if (store.primaryDestinationId === id) store.primaryDestinationId = null
  saveDestinationStore(store)
  return store
}

export function setPrimaryDestination(id: string | null): DestinationStoreFile {
  const store = loadDestinationStore()
  if (id !== null && !store.destinations.some((d) => d.id === id)) {
    throw new Error(`Destination not found: ${id}`)
  }
  store.primaryDestinationId = id
  saveDestinationStore(store)
  return store
}

/**
 * Resolve secret values from env (preferred) or a secrets getter.
 * secretRefs values are env names or secret keys like "backup-s3-secret".
 */
export async function resolveSecrets(
  secretRefs: Record<string, string>,
  getSecret?: (key: string) => Promise<string | null>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [field, ref] of Object.entries(secretRefs ?? {})) {
    if (!ref) continue
    if (process.env[ref]) {
      out[field] = process.env[ref]!
      continue
    }
    if (getSecret) {
      const v = await getSecret(ref)
      if (v) out[field] = v
    }
  }
  return out
}
