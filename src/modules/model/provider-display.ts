// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Human-facing product names for every known provider id.
 * Used when the live provider instance is not registered (disabled / no key / CLI missing)
 * so the UI never falls back to the raw config id (e.g. "kimi-cli", "lmstudio").
 */
import { compatDisplayNames } from './submodules/openai-compat/catalog.js'
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

/** Resolve a stable product name for a provider id. */
export function providerDisplayName(id: string, liveName?: string | null): string {
  return PROVIDER_DISPLAY_NAMES[id] ?? liveName ?? id
}
