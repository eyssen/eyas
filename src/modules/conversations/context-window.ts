// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** Used only when the model catalog has not loaded yet. */
const PROVIDER_WINDOW: Record<string, number> = {
  'grok-cli': 500_000,
  'kimi-cli': 256_000,
  'claude-code': 200_000,
}

const DEFAULT_WINDOW = 200_000

/**
 * Context-bar denominator. Prefer the model's catalog window; never fall back
 * to a smaller hardcoded 200k for Grok (that painted a 164k first turn red).
 *
 * Shared by the conversation ContextBar and the board kanban stripe so the
 * two surfaces cannot disagree about the window.
 */
export function resolveContextWindow(
  modelContextWindow: number | null | undefined,
  providerId?: string | null,
): number {
  if (typeof modelContextWindow === 'number' && modelContextWindow > 0) {
    return modelContextWindow
  }
  if (providerId && PROVIDER_WINDOW[providerId]) return PROVIDER_WINDOW[providerId]
  return DEFAULT_WINDOW
}

/** CLI providers whose window lives in PROVIDER_WINDOW, not a possibly-stale model_config row. */
export function hasKnownProviderWindow(providerId?: string | null): boolean {
  return Boolean(providerId && PROVIDER_WINDOW[providerId])
}
