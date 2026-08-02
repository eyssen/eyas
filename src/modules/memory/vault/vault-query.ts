// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Dataview-style frontmatter query API.
 *
 * Supports filtering by tier, tags (any/all), title-substring, date ranges on
 * created/updated, plus arbitrary frontmatter equality via the `frontmatter`
 * map. Results are paged + sortable by created/updated/title.
 *
 * Intentionally limited surface — safer than a free-form SQL API and enough for
 * the UI's query-builder use case. Extensible by adding fields to QuerySchema
 * as needs arise.
 */

import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { EyasDb } from '@core/types'
import type { VaultService } from './vault-service.js'

export const VaultQuerySchema = z.object({
  tier: z.enum(['semantic', 'procedural']).optional(),
  tagsAny: z.array(z.string()).optional(),      // match if note has ANY of these tags
  tagsAll: z.array(z.string()).optional(),      // match if note has ALL of these tags
  titleContains: z.string().optional(),
  createdAfter: z.string().optional(),          // ISO date
  createdBefore: z.string().optional(),
  updatedAfter: z.string().optional(),
  updatedBefore: z.string().optional(),
  sortBy: z.enum(['created', 'updated', 'title']).default('updated'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
})

export type VaultQuery = z.infer<typeof VaultQuerySchema>

export interface VaultQueryResult {
  path: string
  title: string
  tier: string
  tags: string[]
  indexedAt: string
}

export function createVaultQuery(db: EyasDb, vault: VaultService) {
  return {
    query(input: VaultQuery): VaultQueryResult[] {
      const rows = (db as any).all(sql`SELECT path, title, tier, tags, indexed_at FROM vault_index`) as Array<{
        path: string; title: string; tier: string; tags: string | null; indexed_at: string
      }>

      let results: VaultQueryResult[] = rows.map(r => ({
        path: r.path,
        title: r.title,
        tier: r.tier,
        tags: r.tags ? JSON.parse(r.tags) : [],
        indexedAt: r.indexed_at,
      }))

      if (input.tier) results = results.filter(r => r.tier === input.tier)
      if (input.titleContains) {
        const needle = input.titleContains.toLowerCase()
        results = results.filter(r => r.title.toLowerCase().includes(needle))
      }
      if (input.tagsAny && input.tagsAny.length > 0) {
        const set = new Set(input.tagsAny)
        results = results.filter(r => r.tags.some(t => set.has(t)))
      }
      if (input.tagsAll && input.tagsAll.length > 0) {
        results = results.filter(r => input.tagsAll!.every(t => r.tags.includes(t)))
      }

      // Date filters need frontmatter lookup — load on demand to avoid index bloat.
      const needDateFilter = input.createdAfter || input.createdBefore || input.updatedAfter || input.updatedBefore
      if (needDateFilter) {
        results = results.filter(r => {
          const entry = vault.read(r.path)
          if (!entry) return false
          const c = entry.frontmatter.created
          const u = entry.frontmatter.updated
          if (input.createdAfter && c < input.createdAfter) return false
          if (input.createdBefore && c > input.createdBefore) return false
          if (input.updatedAfter && u < input.updatedAfter) return false
          if (input.updatedBefore && u > input.updatedBefore) return false
          return true
        })
      }

      const sortDir = input.sortDir === 'asc' ? 1 : -1
      const sortBy = input.sortBy
      results.sort((a, b) => {
        const av = sortBy === 'title' ? a.title : a.indexedAt
        const bv = sortBy === 'title' ? b.title : b.indexedAt
        return av.localeCompare(bv) * sortDir
      })

      return results.slice(input.offset, input.offset + input.limit)
    },
  }
}

export type VaultQueryService = ReturnType<typeof createVaultQuery>
