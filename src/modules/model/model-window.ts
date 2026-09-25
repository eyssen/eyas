// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/model/model-window.ts
//
// THE window resolver: how many tokens the selected model takes in, and
// whether it can call tools. Every consumer asks here — the prompt budget
// (prompt-wizard/delivery-profile.ts), the agent runner (through the delivery
// profile), the context bar and the board stripe (conversations/
// context-occupancy.ts) — so no two surfaces can disagree about a model's
// window.
//
// Import-free on purpose: the web bundle re-exports the pure part
// (src/web/src/pages/conversations/context-window.ts). The sources are
// structural types that a ProviderConfigService satisfies, never an import.

/**
 * Known windows of the CLI providers: the fallback for a model the catalog
 * has no window for. A model's own catalog row wins over it (a CLI model
 * discovered with a 1M window is 1M, not the provider's 200k), and the window
 * the runtime reports for the model that answered wins over both (context
 * occupancy, conversations/context-occupancy.ts).
 */
export const PROVIDER_WINDOW: Readonly<Record<string, number>> = {
  'grok-cli': 500_000,
  'kimi-cli': 256_000,
  'claude-code': 200_000,
}

/** The window of a model nothing is known about. */
export const DEFAULT_WINDOW = 200_000

/**
 * Context-bar denominator from a catalog window and a provider id: the
 * catalog window when positive, else the provider's known window, else the
 * default. Never a smaller hardcoded 200k for Grok (that painted a 164k first
 * turn red).
 */
export function pickContextWindow(
  catalogWindow: number | null | undefined,
  providerId?: string | null,
): number {
  if (typeof catalogWindow === 'number' && catalogWindow > 0) return catalogWindow
  if (providerId && PROVIDER_WINDOW[providerId]) return PROVIDER_WINDOW[providerId]
  return DEFAULT_WINDOW
}

export interface ModelWindowTarget {
  providerId?: string | null
  modelId?: string | null
}

/** Where the window came from, most specific first. */
export type ModelWindowSource = 'catalog' | 'provider' | 'default'

export interface ModelWindow {
  contextWindow: number
  supportsTools: boolean
  source: ModelWindowSource
}

/** One model_config row as far as the window is concerned (a ModelConfigRow satisfies it). */
export interface ModelWindowCatalogRow {
  modelId: string
  contextWindow: number | null
  supportsTools: boolean
}

/** The catalog lookup (a ProviderConfigService satisfies it). */
export interface ModelWindowCatalog {
  listModels(providerId: string): ReadonlyArray<ModelWindowCatalogRow>
}

/**
 * The per-model sources. The catalog is the only one: the per-model
 * capability record (model/reasoning) holds reasoning facts only, never a
 * window or tool support, so it is deliberately not a source here.
 */
export interface ModelWindowSources {
  catalog?: ModelWindowCatalog
}

/**
 * The window and tool support of one model. Precedence:
 *   1. model_config.context_window (> 0) — the model's own row, on every
 *      provider, CLIs included;
 *   2. PROVIDER_WINDOW for a CLI provider with a known window;
 *   3. DEFAULT_WINDOW, source 'default'.
 * supportsTools: model_config.supports_tools → true.
 * Never throws: a failing source counts as "nothing known there", so a
 * catalog that throws resolves to the default window.
 */
export function resolveModelContextWindow(
  target: ModelWindowTarget,
  sources: ModelWindowSources = {},
): ModelWindow {
  const providerId = target.providerId || null
  const modelId = target.modelId || null

  let row: ModelWindowCatalogRow | null = null
  let catalogFailed = false
  if (providerId && modelId && sources.catalog) {
    try {
      row = sources.catalog.listModels(providerId).find((r) => r.modelId === modelId) ?? null
    } catch {
      catalogFailed = true
    }
  }

  const supportsTools = row ? row.supportsTools !== false : true

  if (!catalogFailed && row && isPositive(row.contextWindow)) {
    return { contextWindow: row.contextWindow!, supportsTools, source: 'catalog' }
  }
  if (providerId && isPositive(PROVIDER_WINDOW[providerId])) {
    return { contextWindow: PROVIDER_WINDOW[providerId]!, supportsTools, source: 'provider' }
  }
  return { contextWindow: DEFAULT_WINDOW, supportsTools, source: 'default' }
}

function isPositive(n: number | null | undefined): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}
