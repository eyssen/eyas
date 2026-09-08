// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Anthropic Messages API-compatible endpoints (OpenClaw catalog).
 * Same wire protocol as Anthropic; different host + product models.
 */

export interface AnthropicCompatDef {
  id: string
  name: string
  descKey: string
  secretName: string
  baseURL: string
  models: Array<{ id: string; name: string; contextWindow?: number; maxOutputTokens?: number }>
  defaultModel?: string
}

export const ANTHROPIC_COMPAT_CATALOG: AnthropicCompatDef[] = [
  {
    id: 'minimax',
    name: 'MiniMax',
    descKey: 'minimax',
    secretName: 'minimax-api-key',
    // OpenClaw: MINIMAX_PORTAL_BASE_URL / anthropic-messages
    baseURL: 'https://api.minimax.io/anthropic',
    defaultModel: 'MiniMax-M2.5',
    models: [
      { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', contextWindow: 200_000, maxOutputTokens: 16_384 },
      { id: 'MiniMax-M2', name: 'MiniMax M2', contextWindow: 200_000, maxOutputTokens: 16_384 },
    ],
  },
  {
    id: 'synthetic',
    name: 'Synthetic',
    descKey: 'synthetic',
    secretName: 'synthetic-api-key',
    baseURL: 'https://api.synthetic.new/anthropic',
    defaultModel: 'hf:MiniMaxAI/MiniMax-M2.5',
    models: [
      { id: 'hf:MiniMaxAI/MiniMax-M2.5', name: 'MiniMax M2.5 (Synthetic)', contextWindow: 200_000, maxOutputTokens: 16_384 },
    ],
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    descKey: 'xiaomi',
    secretName: 'xiaomi-api-key',
    baseURL: 'https://api.xiaomimimo.com/anthropic',
    defaultModel: 'mimo-v2-flash',
    models: [
      { id: 'mimo-v2-flash', name: 'MiMo V2 Flash', contextWindow: 128_000, maxOutputTokens: 16_384 },
    ],
  },
]

export function anthropicCompatSecretMap(): Record<string, string> {
  return Object.fromEntries(ANTHROPIC_COMPAT_CATALOG.map((p) => [p.id, p.secretName]))
}

export function anthropicCompatDisplayNames(): Record<string, string> {
  return Object.fromEntries(ANTHROPIC_COMPAT_CATALOG.map((p) => [p.id, p.name]))
}
