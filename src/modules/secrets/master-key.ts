import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { importKey } from './crypto.js'

export interface MasterKeyResult {
  key: CryptoKey
  source: 'env' | 'file'
}

export interface ResolveMasterKeyOptions {
  keyFilePath?: string
}

const DEFAULT_KEY_FILE = resolve('data', 'master.key')

export async function resolveMasterKey(options?: ResolveMasterKeyOptions): Promise<MasterKeyResult | null> {
  // 1. Try env var (Docker/K8s/systemd)
  const envKey = process.env.EYAS_MASTER_KEY
  if (envKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
      throw new Error('EYAS_MASTER_KEY must be a 64-character hex string (256-bit key)')
    }
    const key = await importKey(envKey)
    return { key, source: 'env' }
  }

  // 2. Try key file (cross-platform)
  const keyFilePath = options?.keyFilePath ?? DEFAULT_KEY_FILE
  if (existsSync(keyFilePath)) {
    const hex = readFileSync(keyFilePath, 'utf-8').trim()
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(`Invalid master key in ${keyFilePath} — must be 64-character hex string`)
    }
    const key = await importKey(hex)
    return { key, source: 'file' }
  }

  // 3. No key found
  return null
}

export function storeMasterKeyToFile(hexKey: string, keyFilePath?: string): boolean {
  const filePath = keyFilePath ?? DEFAULT_KEY_FILE
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, hexKey + '\n', { mode: 0o600 })
    return true
  } catch {
    return false
  }
}
