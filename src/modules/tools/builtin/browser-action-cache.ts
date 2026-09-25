// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { generateId } from '@shared/crypto'

export const ACTION_CACHE_VERSION = 1
export const ACTION_CACHE_MAX_ENTRIES = 200

export const cacheableActions = ['click', 'fill', 'hover', 'select'] as const
export type CacheableAction = (typeof cacheableActions)[number]

const locatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('css'), value: z.string().min(1).max(500) }),
  z.object({
    kind: z.literal('role'),
    role: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
  }),
])

export type DurableLocator = z.infer<typeof locatorSchema>

const entrySchema = z.object({
  id: z.string().min(1),
  origin: z.string().url(),
  intent: z.string().min(1).max(200),
  action: z.enum(cacheableActions),
  locator: locatorSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  hits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
})

export type ActionCacheEntry = z.infer<typeof entrySchema>

const fileSchema = z.object({
  version: z.literal(ACTION_CACHE_VERSION),
  entries: z.array(entrySchema).max(ACTION_CACHE_MAX_ENTRIES),
})

export type ActionCacheFile = z.infer<typeof fileSchema>

export function normalizeIntent(intent: string): string {
  return intent.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function originFromUrl(url: string): string {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Action cache only stores http(s) origins')
  }
  return parsed.origin
}

export function sanitizeProjectSlug(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60)
  if (!safe || safe.startsWith('.')) throw new Error('Invalid project id for action cache')
  return safe
}

/**
 * Vault first (project folder, else procedural), instance dataDir as fallback.
 * JSON is not a vault markdown note — the indexer only walks `.md`.
 */
export function resolveActionCachePath(opts: {
  vaultBasePath?: string | null
  dataDir: string
  projectId?: string | null
}): string {
  const slug = opts.projectId ? sanitizeProjectSlug(opts.projectId) : null
  if (opts.vaultBasePath) {
    if (slug) return join(opts.vaultBasePath, 'projects', slug, 'browser-action-cache.json')
    return join(opts.vaultBasePath, 'procedural', 'browser-action-cache.json')
  }
  if (slug) return join(opts.dataDir, 'browser', 'action-cache', `${slug}.json`)
  return join(opts.dataDir, 'browser', 'action-cache.json')
}

function emptyFile(): ActionCacheFile {
  return { version: ACTION_CACHE_VERSION, entries: [] }
}

async function readFileSafe(path: string): Promise<ActionCacheFile> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = fileSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return emptyFile()
    return parsed.data
  } catch {
    return emptyFile()
  }
}

async function writeFileSafe(path: string, file: ActionCacheFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

function evict(entries: ActionCacheEntry[]): ActionCacheEntry[] {
  if (entries.length <= ACTION_CACHE_MAX_ENTRIES) return entries
  return [...entries]
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(entries.length - ACTION_CACHE_MAX_ENTRIES)
}

export interface ActionCacheStore {
  path: string
  remember(input: {
    origin: string
    intent: string
    action: CacheableAction
    locator: DurableLocator
  }): Promise<ActionCacheEntry>
  lookup(origin: string, intent: string): Promise<ActionCacheEntry | null>
  hit(id: string): Promise<void>
  miss(id: string): Promise<void>
  forget(input: { intent: string; origin?: string }): Promise<{ removed: number }>
  list(origin?: string): Promise<ActionCacheEntry[]>
}

export function createActionCacheStore(opts: {
  path: string
}): ActionCacheStore {
  const path = opts.path

  async function mutate(fn: (file: ActionCacheFile) => ActionCacheFile): Promise<ActionCacheFile> {
    const next = fn(await readFileSafe(path))
    next.entries = evict(next.entries)
    await writeFileSafe(path, next)
    return next
  }

  return {
    path,

    async remember(input) {
      const intent = normalizeIntent(input.intent)
      if (!intent) throw new Error('intent is required to remember a locator')
      locatorSchema.parse(input.locator)
      const origin = originFromUrl(input.origin)
      const now = new Date().toISOString()
      let saved: ActionCacheEntry | null = null
      await mutate((file) => {
        const existing = file.entries.find((e) => e.origin === origin && e.intent === intent)
        if (existing) {
          existing.action = input.action
          existing.locator = input.locator
          existing.updatedAt = now
          saved = existing
          return file
        }
        const entry: ActionCacheEntry = {
          id: generateId(),
          origin,
          intent,
          action: input.action,
          locator: input.locator,
          createdAt: now,
          updatedAt: now,
          hits: 0,
          misses: 0,
        }
        saved = entry
        file.entries.push(entry)
        return file
      })
      if (!saved) throw new Error('Failed to remember locator')
      return saved
    },

    async lookup(origin, intent) {
      const key = normalizeIntent(intent)
      if (!key) return null
      const file = await readFileSafe(path)
      const matches = file.entries.filter((e) => e.origin === origin && e.intent === key)
      if (!matches.length) return null
      return matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    },

    async hit(id) {
      const now = new Date().toISOString()
      await mutate((file) => {
        const entry = file.entries.find((e) => e.id === id)
        if (entry) {
          entry.hits += 1
          entry.updatedAt = now
        }
        return file
      })
    },

    async miss(id) {
      const now = new Date().toISOString()
      await mutate((file) => {
        const entry = file.entries.find((e) => e.id === id)
        if (entry) {
          entry.misses += 1
          entry.updatedAt = now
        }
        return file
      })
    },

    async forget(input) {
      const intent = normalizeIntent(input.intent)
      let removed = 0
      await mutate((file) => {
        const before = file.entries.length
        file.entries = file.entries.filter((e) => {
          if (e.intent !== intent) return true
          if (input.origin && e.origin !== input.origin) return true
          return false
        })
        removed = before - file.entries.length
        return file
      })
      return { removed }
    },

    async list(origin) {
      const file = await readFileSafe(path)
      const entries = origin ? file.entries.filter((e) => e.origin === origin) : file.entries
      return entries.map((e) => ({
        ...e,
        locator: { ...e.locator },
      }))
    },
  }
}

export function isIndexSelector(selector: string): boolean {
  return /data-eyas-index/.test(selector)
}

export function fallbackDurableLocator(selector: string): DurableLocator | null {
  if (!selector || isIndexSelector(selector)) return null
  const parsed = locatorSchema.safeParse({ kind: 'css', value: selector })
  return parsed.success ? parsed.data : null
}

export function publicCacheEntry(entry: ActionCacheEntry): Record<string, unknown> {
  return {
    id: entry.id,
    origin: entry.origin,
    intent: entry.intent,
    action: entry.action,
    locator: entry.locator,
    hits: entry.hits,
    misses: entry.misses,
    updatedAt: entry.updatedAt,
  }
}
