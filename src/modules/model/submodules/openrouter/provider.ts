import { createOpenAIProvider } from '../openai/provider.js'
import type { AIProvider, ModelInfo } from '../../types.js'

const OPENROUTER_MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (OpenRouter)', provider: 'openrouter', contextWindow: 200000, maxOutputTokens: 16000, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'openai/gpt-4o', name: 'GPT-4o (OpenRouter)', provider: 'openrouter', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash (OpenRouter)', provider: 'openrouter', contextWindow: 1048576, maxOutputTokens: 8192, supportsTools: true, supportsImages: true, supportsStreaming: true },
  { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B (OpenRouter)', provider: 'openrouter', contextWindow: 131072, maxOutputTokens: 4096, supportsTools: true, supportsImages: false, supportsStreaming: true },
]

export function createOpenRouterProvider(apiKey: string): AIProvider {
  const base = createOpenAIProvider({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    models: OPENROUTER_MODELS,
    defaultHeaders: {
      'HTTP-Referer': 'https://eyas.app',
      'X-Title': 'EYAS',
    },
  })

  return {
    ...base,
    async fetchModels(): Promise<ModelInfo[]> {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) return OPENROUTER_MODELS
      const data = await res.json() as { data: Array<{ id: string; name: string; context_length: number; top_provider?: { max_completion_tokens?: number } }> }
      return data.data.map(m => ({
        id: m.id,
        name: m.name || m.id,
        provider: 'openrouter',
        contextWindow: m.context_length || 0,
        maxOutputTokens: m.top_provider?.max_completion_tokens || 4096,
        supportsTools: true,
        supportsImages: true,
        supportsStreaming: true,
      }))
    },
  }
}
