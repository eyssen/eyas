// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Resolve which search sources a conversation / tool call may use.
 *
 * Precedence (highest wins):
 *  1. Explicit tool args (sourceIds / sourceId / labels / version / edition)
 *  2. Conversation.searchContext
 *  3. Project.indexedSources (search source IDs)
 *  4. Project type.indexedSources
 *  5. Fallback: all ready sources — but if multiple odoo-family versions exist
 *     without a pin, needsPin=true and odoo-family sources are excluded
 *     (safer than silent cross-version mix).
 */

import type { SearchContextSpec, SearchSource } from './types.js'

export interface ExplicitSearchFilter {
  sourceIds?: string[]
  sourceId?: string
  labels?: string[]
  version?: string
  edition?: string
}

export interface SearchContextPin {
  /** Resolved ready source ids to search (empty if needsPin). */
  sourceIds: string[]
  sources: SearchSource[]
  /** Absolute roots from source config.paths (for odoo walk tools). */
  roots: string[]
  /** Human-readable reason for debugging / prompt. */
  reason: string
  /** True when a pin was applied (explicit, conversation, or project). */
  pinned: boolean
  /**
   * True when the operator must pin before searching odoo-family sources
   * (multiple versions ready, no pin).
   */
  needsPin: boolean
  available: Array<{
    id: string
    name: string
    label?: string
    version?: string
    edition?: string
    family?: string
    status: string
  }>
}

export interface ConversationSearchRow {
  searchContext?: SearchContextSpec | null
  projectId?: string | null
}

export interface ProjectSearchRow {
  indexedSources?: string[] | null
  typeId?: string | null
}

export interface ProjectTypeSearchRow {
  indexedSources?: string[] | null
}

export interface SearchContextResolverDeps {
  listSources: () => SearchSource[]
  getConversation?: (id: string) => ConversationSearchRow | null
  getProject?: (id: string) => ProjectSearchRow | null
  getProjectType?: (id: string) => ProjectTypeSearchRow | null
}

function meta(s: SearchSource) {
  const c = s.config ?? {}
  return {
    label: typeof c.label === 'string' ? c.label : undefined,
    version: typeof c.version === 'string' ? c.version : undefined,
    edition: typeof c.edition === 'string' ? c.edition : undefined,
    family: typeof c.family === 'string' ? c.family : undefined,
    tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
  }
}

function isOdooFamily(s: SearchSource): boolean {
  const m = meta(s)
  if (m.family === 'odoo') return true
  // Heuristic: version set + (label or edition) → treat as versioned Odoo tree
  if (m.version && (m.label || m.edition || m.tags.includes('odoo'))) return true
  return false
}

function sourceRoots(s: SearchSource): string[] {
  return Array.isArray(s.config.paths) ? (s.config.paths as string[]).filter(Boolean) : []
}

function matchesFilter(s: SearchSource, filter: ExplicitSearchFilter): boolean {
  const m = meta(s)
  if (filter.sourceIds?.length) {
    if (!filter.sourceIds.includes(s.id)) return false
  } else if (filter.sourceId) {
    if (s.id !== filter.sourceId) return false
  }
  if (filter.labels?.length) {
    const labels = new Set(filter.labels.map((l) => l.toLowerCase()))
    const candidates = [m.label, s.name, s.id].filter(Boolean).map((x) => String(x).toLowerCase())
    if (!candidates.some((c) => labels.has(c))) return false
  }
  if (filter.version) {
    if ((m.version ?? '').toLowerCase() !== filter.version.toLowerCase()) return false
  }
  if (filter.edition) {
    if ((m.edition ?? '').toLowerCase() !== filter.edition.toLowerCase()) return false
  }
  return true
}

function hasExplicitFilter(f?: ExplicitSearchFilter | null): boolean {
  if (!f) return false
  return Boolean(
    (f.sourceIds && f.sourceIds.length) ||
      f.sourceId ||
      (f.labels && f.labels.length) ||
      f.version ||
      f.edition,
  )
}

function availableList(sources: SearchSource[]) {
  return sources.map((s) => {
    const m = meta(s)
    return {
      id: s.id,
      name: s.name,
      label: m.label,
      version: m.version,
      edition: m.edition,
      family: m.family,
      status: s.status,
    }
  })
}

function pinFromSources(
  sources: SearchSource[],
  reason: string,
  pinned: boolean,
  needsPin = false,
): SearchContextPin {
  return {
    sourceIds: sources.map((s) => s.id),
    sources,
    roots: sources.flatMap(sourceRoots),
    reason,
    pinned,
    needsPin,
    available: availableList(sources.length ? sources : []),
  }
}

/**
 * Detect multi-version odoo-family conflict: ≥2 ready sources with different
 * version strings (or different labels when version missing).
 */
export function hasMultiVersionOdooConflict(ready: SearchSource[]): boolean {
  const odoo = ready.filter(isOdooFamily)
  if (odoo.length < 2) return false
  const keys = new Set(
    odoo.map((s) => {
      const m = meta(s)
      return `${m.version ?? '?'}|${m.edition ?? '?'}|${m.label ?? s.id}`
    }),
  )
  return keys.size > 1
}

export function createSearchContextResolver(deps: SearchContextResolverDeps) {
  function listReady(): SearchSource[] {
    return deps.listSources().filter((s) => s.status === 'ready')
  }

  function resolveFromSpec(
    ready: SearchSource[],
    spec: ExplicitSearchFilter,
    reason: string,
  ): SearchContextPin {
    const matched = ready.filter((s) => matchesFilter(s, spec))
    const pin = pinFromSources(matched, reason, true, false)
    pin.available = availableList(ready)
    return pin
  }

  function resolve(opts: {
    conversationId?: string | null
    explicit?: ExplicitSearchFilter | null
  }): SearchContextPin {
    const all = deps.listSources()
    const ready = all.filter((s) => s.status === 'ready')
    const available = availableList(all)

    // 1. Explicit tool args
    if (hasExplicitFilter(opts.explicit)) {
      const pin = resolveFromSpec(ready, opts.explicit!, 'explicit tool filter')
      pin.available = available
      return pin
    }

    // 2. Conversation search_context
    if (opts.conversationId && deps.getConversation) {
      const conv = deps.getConversation(opts.conversationId)
      const sc = conv?.searchContext
      if (sc && hasExplicitFilter(sc)) {
        const pin = resolveFromSpec(ready, sc, 'conversation.search_context')
        pin.available = available
        return pin
      }

      // 3. Project indexed_sources
      if (conv?.projectId && deps.getProject) {
        const project = deps.getProject(conv.projectId)
        if (project?.indexedSources?.length) {
          const pin = resolveFromSpec(
            ready,
            { sourceIds: project.indexedSources },
            'project.indexed_sources',
          )
          pin.available = available
          return pin
        }

        // 4. Project type
        if (project?.typeId && deps.getProjectType) {
          const pt = deps.getProjectType(project.typeId)
          if (pt?.indexedSources?.length) {
            const pin = resolveFromSpec(
              ready,
              { sourceIds: pt.indexedSources },
              'project_type.indexed_sources',
            )
            pin.available = available
            return pin
          }
        }
      }
    }

    // 5. Fallback
    if (hasMultiVersionOdooConflict(ready)) {
      const nonOdoo = ready.filter((s) => !isOdooFamily(s))
      return {
        sourceIds: nonOdoo.map((s) => s.id),
        sources: nonOdoo,
        roots: nonOdoo.flatMap(sourceRoots),
        reason:
          'multiple odoo-family versions ready — pin required (set conversation search_context or project indexed_sources)',
        pinned: false,
        needsPin: true,
        available,
      }
    }

    return {
      sourceIds: ready.map((s) => s.id),
      sources: ready,
      roots: ready.flatMap(sourceRoots),
      reason: 'all ready sources (no pin)',
      pinned: false,
      needsPin: false,
      available,
    }
  }

  return { resolve, listReady, meta, isOdooFamily }
}

export type SearchContextResolver = ReturnType<typeof createSearchContextResolver>
