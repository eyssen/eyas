import { readFile } from 'fs/promises'
import { join } from 'path'

const DEFAULT_TIMEOUT = 5000

interface Config {
  host: string
  port: number
}

export function parseConfig(raw: string): Config {
  const parsed = JSON.parse(raw)
  return { host: parsed.host ?? 'localhost', port: parsed.port ?? 3000 }
}

export class DataService {
  private db: Map<string, unknown> = new Map()

  async get(key: string): Promise<unknown> {
    return this.db.get(key) ?? null
  }

  async set(key: string, value: unknown): Promise<void> {
    this.db.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.db.delete(key)
  }

  async clear(): Promise<void> {
    this.db.clear()
  }
}

export async function loadFile(relativePath: string): Promise<string> {
  const normalized = relativePath.replace(/\.\.\//g, '')
  const resolved = join(__dirname, normalized)
  return readFile(resolved, 'utf-8')
}
