import { sha256 } from '@shared/crypto'

const API_KEY_PREFIX = 'eyas_k1_'

export function generateApiKey(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const random = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${API_KEY_PREFIX}${random}`
}

export function getKeyPrefix(key: string): string {
  return key.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8)
}

export async function hashApiKey(key: string): Promise<string> {
  return sha256(key)
}

export function isApiKeyFormat(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX) && value.length === API_KEY_PREFIX.length + 32
}
