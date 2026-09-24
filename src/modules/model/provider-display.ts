// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * The one display source for providers: the product name and the kind of
 * every known provider id. GET /api/v1/model/providers serves both, and the
 * web reads them from there (src/web/src/lib/provider-display.ts) — it keeps
 * no name map or CLI-id list of its own. The name is also used when the live
 * provider instance is not registered (disabled / no key / CLI missing), so
 * the UI never falls back to the raw config id (e.g. "kimi-cli", "lmstudio").
 */
import { OPENAI_COMPAT_CATALOG, compatDisplayNames } from './submodules/openai-compat/catalog.js'
import { anthropicCompatDisplayNames } from './submodules/anthropic-compat/catalog.js'

export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
  kimi: 'Kimi',
  'claude-code': 'Claude Code CLI',
  'claude-code-sdk': 'Claude Code SDK',
  'grok-cli': 'Grok CLI',
  'kimi-cli': 'Kimi Code CLI',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  ...compatDisplayNames(),
  ...anthropicCompatDisplayNames(),
}

/**
 * How a provider runs:
 * - 'cli': a host CLI agent EYAS spawns (signs in for itself, no API key);
 * - 'local': a model server on this machine or network (no key needed);
 * - 'api': a hosted API reached with a key — also every id not listed here.
 */
export type ProviderKind = 'api' | 'cli' | 'local'

export const PROVIDER_KIND: Record<string, ProviderKind> = {
  'claude-code': 'cli',
  'claude-code-sdk': 'cli',
  'grok-cli': 'cli',
  'kimi-cli': 'cli',
  ollama: 'local',
  lmstudio: 'local',
  ...Object.fromEntries(OPENAI_COMPAT_CATALOG.filter((p) => p.local).map((p) => [p.id, 'local' as const])),
}

/** Resolve a stable product name for a provider id. */
export function providerDisplayName(id: string, liveName?: string | null): string {
  return PROVIDER_DISPLAY_NAMES[id] ?? liveName ?? id
}

/** The kind of a provider id; an unknown id is an API provider. */
export function providerKind(id: string): ProviderKind {
  return Object.prototype.hasOwnProperty.call(PROVIDER_KIND, id) ? PROVIDER_KIND[id] : 'api'
}
