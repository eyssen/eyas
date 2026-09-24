// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// How the UI names a provider and tells a CLI provider apart — from one
// source: GET /model/providers, which serves every provider's product name
// and kind (src/modules/model/provider-display.ts). The web keeps no name map
// or CLI-id list of its own. The catalog is fetched once per page load and
// shared; until it has loaded (or when the viewer may not read it) a provider
// reads as its id and counts as an API provider.
//
// Components call useProviderDisplay(): it loads the catalog and re-renders
// when it arrives. Pure view builders (model-picker.ts, stream-error.tsx, …)
// call providerName(id), which reads the same cache; the component that
// renders them holds useProviderDisplay() so the names refresh.
//
// Only brand names live here. i18n'd per-provider copy (descriptions, CLI
// sign-in hints, the setup wizard's CLI texts) stays keyed by provider id in
// the owning module's locales.

import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { z } from 'zod'
import { api } from '@/lib/api'

export const PROVIDER_KINDS = ['api', 'cli', 'local'] as const

/** 'cli': a host CLI agent EYAS runs · 'local': a model server on this machine or network · 'api': a hosted API. */
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

export interface ProviderDisplayEntry {
  id: string
  name: string
  kind: ProviderKind
}

export interface ProviderDisplay {
  /** The product name; the id itself when the catalog does not know it. */
  name(id: string): string
  /** The kind; 'api' when the catalog does not know the id. */
  kind(id: string): ProviderKind
  isCli(id: string): boolean
}

type Catalog = Readonly<Record<string, ProviderDisplayEntry>>

/**
 * One row of GET /model/providers as far as display goes; everything else is
 * ignored. Only the id is required: a bad name reads as the id, a bad kind as 'api'.
 */
const CatalogRowSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(200).optional().catch(undefined),
  kind: z.enum(PROVIDER_KINDS).optional().catch(undefined),
})

const CatalogBodySchema = z.object({ providers: z.array(z.unknown()) })

/**
 * The catalog in a GET /model/providers body. A malformed row is skipped, a
 * missing name reads as the id and a missing or unknown kind as 'api'; a
 * body that is not a provider list yields null.
 */
export function parseProviderCatalog(body: unknown): Catalog | null {
  const parsed = CatalogBodySchema.safeParse(body)
  if (!parsed.success) return null
  const out: Record<string, ProviderDisplayEntry> = Object.create(null)
  for (const raw of parsed.data.providers) {
    const row = CatalogRowSchema.safeParse(raw)
    if (!row.success) continue
    const { id, name, kind } = row.data
    out[id] = { id, name: name?.trim() || id, kind: kind ?? 'api' }
  }
  return out
}

/** Name and kind lookups over a catalog; a missing catalog or id falls back to the id and 'api'. */
export function providerDisplayFrom(catalog: Catalog | null | undefined): ProviderDisplay {
  const entry = (id: string): ProviderDisplayEntry | undefined =>
    catalog && Object.prototype.hasOwnProperty.call(catalog, id) ? catalog[id] : undefined
  return {
    name: (id) => entry(id)?.name ?? id,
    kind: (id) => entry(id)?.kind ?? 'api',
    isCli: (id) => entry(id)?.kind === 'cli',
  }
}

// ─── The shared cache ───────────────────────────────────────────────

/** A failed load (no permission, offline) is retried by the next mount after this long. */
const RETRY_AFTER_MS = 30_000

interface CatalogState {
  catalog: Catalog | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  failedAt: number
}

const useCatalogStore = create<CatalogState>(() => ({ catalog: null, status: 'idle', failedAt: 0 }))

let inflight: Promise<void> | null = null

/**
 * Fetch the catalog unless it is loaded or loading (a failure is retried
 * after a pause). Never rejects: on failure the names stay ids.
 */
export function loadProviderCatalog(options: { force?: boolean } = {}): Promise<void> {
  const { status, failedAt } = useCatalogStore.getState()
  if (inflight) return inflight
  if (!options.force) {
    if (status === 'ready') return Promise.resolve()
    if (status === 'error' && Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve()
  }
  useCatalogStore.setState({ status: 'loading' })
  inflight = (async () => {
    try {
      const catalog = parseProviderCatalog(await api.get<unknown>('/model/providers'))
      if (!catalog) throw new Error('not a provider list')
      useCatalogStore.setState({ catalog, status: 'ready', failedAt: 0 })
    } catch {
      // Keep whatever was loaded before; the names fall back to ids.
      useCatalogStore.setState({ status: 'error', failedAt: Date.now() })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Replace the cached catalog with rows already fetched (or, in tests, given). */
export function setProviderCatalog(rows: readonly unknown[]): void {
  useCatalogStore.setState({ catalog: parseProviderCatalog({ providers: rows }), status: 'ready', failedAt: 0 })
}

/** Forget the cached catalog (tests; a later mount fetches it again). */
export function resetProviderCatalog(): void {
  inflight = null
  useCatalogStore.setState({ catalog: null, status: 'idle', failedAt: 0 })
}

/** The product name of a provider from the cached catalog (the id until it has loaded). */
export function providerName(id: string): string {
  return providerDisplayFrom(useCatalogStore.getState().catalog).name(id)
}

/** Names and kinds from GET /model/providers; loads the catalog once and re-renders when it arrives. */
export function useProviderDisplay(): ProviderDisplay {
  const catalog = useCatalogStore((s) => s.catalog)
  useEffect(() => {
    void loadProviderCatalog()
  }, [])
  return useMemo(() => providerDisplayFrom(catalog), [catalog])
}
