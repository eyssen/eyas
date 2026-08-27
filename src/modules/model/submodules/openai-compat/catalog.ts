// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * OpenAI-compatible cloud / gateway providers (catalog driven).
 * Base URLs and product names mirror OpenClaw's provider catalog so operators
 * who know OpenClaw find the same endpoints and secret naming patterns.
 *
 * Sources (OpenClaw 2026.3+):
 * - docs/providers/*, docs/concepts/model-providers.md
 * - dist constants (MISTRAL_BASE_URL, XAI, TOGETHER, VENICE, …)
 */

export interface CompatProviderDef {
  /** EYAS provider id (config + secrets key prefix). */
  id: string
  /** Product name shown in UI. */
  name: string
  /** Short description i18n key suffix under providers.card.desc.* */
  descKey: string
  /** Secrets vault name (scope system). */
  secretName: string
  /** OpenAI-compatible base URL (…/v1). */
  baseURL: string
  /** Static seed models when list/fetch is empty. */
  models: Array<{ id: string; name: string; contextWindow?: number; maxOutputTokens?: number; supportsImages?: boolean }>
  /** Optional static default headers (OpenRouter-style). */
  defaultHeaders?: Record<string, string>
  /** Local/self-hosted — no required API key for probe; empty key allowed. */
  local?: boolean
  /** When true, only register if secret is present OR local. */
  requiresKey?: boolean
}

function m(
  id: string,
  name: string,
  opts: { contextWindow?: number; maxOutputTokens?: number; supportsImages?: boolean } = {},
) {
  return {
    id,
    name,
    contextWindow: opts.contextWindow ?? 128_000,
    maxOutputTokens: opts.maxOutputTokens ?? 16_384,
    supportsImages: opts.supportsImages ?? true,
  }
}

/**
 * Cloud OpenAI-compatible providers present in OpenClaw but not first-class in EYAS
 * before this catalog (OpenRouter / Kimi / OpenAI already have dedicated modules).
 */
export const OPENAI_COMPAT_CATALOG: CompatProviderDef[] = [
  {
    id: 'xai',
    name: 'xAI',
    descKey: 'xai',
    secretName: 'xai-api-key',
    baseURL: 'https://api.x.ai/v1',
    models: [
      m('grok-4', 'Grok 4', { contextWindow: 256_000 }),
      m('grok-3', 'Grok 3', { contextWindow: 131_072 }),
      m('grok-3-mini', 'Grok 3 Mini', { contextWindow: 131_072 }),
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    descKey: 'mistral',
    secretName: 'mistral-api-key',
    baseURL: 'https://api.mistral.ai/v1',
    models: [
      m('mistral-large-latest', 'Mistral Large'),
      m('mistral-medium-latest', 'Mistral Medium'),
      m('mistral-small-latest', 'Mistral Small'),
      m('codestral-latest', 'Codestral', { supportsImages: false }),
      m('pixtral-large-latest', 'Pixtral Large'),
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    descKey: 'groq',
    secretName: 'groq-api-key',
    baseURL: 'https://api.groq.com/openai/v1',
    models: [
      m('llama-3.3-70b-versatile', 'Llama 3.3 70B', { supportsImages: false }),
      m('llama-3.1-8b-instant', 'Llama 3.1 8B Instant', { supportsImages: false }),
      m('qwen/qwen3-32b', 'Qwen3 32B', { supportsImages: false }),
      m('moonshotai/kimi-k2-instruct', 'Kimi K2 Instruct', { supportsImages: false }),
    ],
  },
  {
    id: 'together',
    name: 'Together AI',
    descKey: 'together',
    secretName: 'together-api-key',
    baseURL: 'https://api.together.xyz/v1',
    models: [
      m('meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'Llama 3.1 70B Turbo', { supportsImages: false }),
      m('deepseek-ai/DeepSeek-R1', 'DeepSeek R1', { supportsImages: false }),
      m('Qwen/Qwen2.5-72B-Instruct-Turbo', 'Qwen 2.5 72B Turbo', { supportsImages: false }),
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    descKey: 'deepseek',
    secretName: 'deepseek-api-key',
    baseURL: 'https://api.deepseek.com/v1',
    models: [
      m('deepseek-chat', 'DeepSeek Chat', { contextWindow: 128_000, supportsImages: false }),
      m('deepseek-reasoner', 'DeepSeek Reasoner', { contextWindow: 128_000, supportsImages: false }),
    ],
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    descKey: 'cerebras',
    secretName: 'cerebras-api-key',
    baseURL: 'https://api.cerebras.ai/v1',
    models: [
      m('llama-3.3-70b', 'Llama 3.3 70B', { supportsImages: false }),
      m('zai-glm-4.7', 'GLM 4.7 (Cerebras)', { supportsImages: false }),
    ],
  },
  {
    id: 'venice',
    name: 'Venice AI',
    descKey: 'venice',
    secretName: 'venice-api-key',
    baseURL: 'https://api.venice.ai/api/v1',
    models: [
      m('llama-3.3-70b', 'Llama 3.3 70B', { supportsImages: false }),
      m('qwen3-235b', 'Qwen3 235B', { supportsImages: false }),
    ],
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    descKey: 'huggingface',
    secretName: 'huggingface-api-key',
    baseURL: 'https://router.huggingface.co/v1',
    models: [
      m('deepseek-ai/DeepSeek-R1', 'DeepSeek R1', { supportsImages: false }),
      m('meta-llama/Llama-3.3-70B-Instruct', 'Llama 3.3 70B', { supportsImages: false }),
      m('Qwen/Qwen2.5-72B-Instruct', 'Qwen 2.5 72B', { supportsImages: false }),
    ],
  },
  {
    id: 'nvidia',
    name: 'NVIDIA',
    descKey: 'nvidia',
    secretName: 'nvidia-api-key',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    models: [
      m('meta/llama-3.3-70b-instruct', 'Llama 3.3 70B', { contextWindow: 131_072, supportsImages: false }),
      m('nvidia/llama-3.1-nemotron-70b-instruct', 'Nemotron 70B', { contextWindow: 131_072, supportsImages: false }),
    ],
  },
  {
    id: 'zai',
    name: 'Z.AI',
    descKey: 'zai',
    secretName: 'zai-api-key',
    baseURL: 'https://api.z.ai/api/paas/v4',
    models: [
      m('glm-5', 'GLM-5', { contextWindow: 128_000, supportsImages: false }),
      m('glm-4.7', 'GLM-4.7', { contextWindow: 128_000, supportsImages: false }),
      m('glm-4.6', 'GLM-4.6', { contextWindow: 128_000, supportsImages: false }),
    ],
  },
  {
    id: 'kilocode',
    name: 'Kilo Gateway',
    descKey: 'kilocode',
    secretName: 'kilocode-api-key',
    // OpenClaw uses a trailing slash on the gateway path.
    baseURL: 'https://api.kilo.ai/api/gateway',
    models: [
      m('anthropic/claude-opus-4.6', 'Claude Opus 4.6 (Kilo)'),
      m('anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5 (Kilo)'),
      m('google/gemini-3-flash-preview', 'Gemini 3 Flash (Kilo)'),
    ],
  },
  {
    id: 'vercel-ai-gateway',
    name: 'Vercel AI Gateway',
    descKey: 'vercelAiGateway',
    secretName: 'vercel-ai-gateway-api-key',
    baseURL: 'https://ai-gateway.vercel.sh/v1',
    models: [
      m('anthropic/claude-opus-4.6', 'Claude Opus 4.6 (Vercel)'),
      m('anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5 (Vercel)'),
      m('openai/gpt-5.4', 'GPT-5.4 (Vercel)'),
    ],
  },
  {
    id: 'qianfan',
    name: 'Qianfan',
    descKey: 'qianfan',
    secretName: 'qianfan-api-key',
    baseURL: 'https://qianfan.baidubce.com/v2',
    models: [
      m('ernie-4.5-turbo-128k', 'ERNIE 4.5 Turbo', { contextWindow: 128_000, supportsImages: false }),
      m('deepseek-v3', 'DeepSeek V3 (Qianfan)', { supportsImages: false }),
    ],
  },
  {
    id: 'vllm',
    name: 'vLLM',
    descKey: 'vllm',
    secretName: 'vllm-api-key',
    baseURL: 'http://127.0.0.1:8000/v1',
    models: [m('default', 'vLLM default', { supportsImages: false })],
    local: true,
    requiresKey: false,
  },
]

/** Secret name → provider id for UI key sections. */
export function compatSecretMap(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of OPENAI_COMPAT_CATALOG) {
    if (p.local && !p.requiresKey) continue
    out[p.id] = p.secretName
  }
  return out
}

export function compatDisplayNames(): Record<string, string> {
  return Object.fromEntries(OPENAI_COMPAT_CATALOG.map((p) => [p.id, p.name]))
}

export function compatProviderIdsRequiringKey(): string[] {
  return OPENAI_COMPAT_CATALOG.filter((p) => p.requiresKey !== false || !p.local).map((p) => p.id)
}
