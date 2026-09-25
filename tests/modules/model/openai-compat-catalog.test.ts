// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  OPENAI_COMPAT_CATALOG,
  compatDisplayNames,
  compatSecretMap,
} from '@modules/model/submodules/openai-compat/catalog'
import { createCompatProvider } from '@modules/model/submodules/openai-compat/provider'
import { ANTHROPIC_COMPAT_CATALOG } from '@modules/model/submodules/anthropic-compat/catalog'
import { createAnthropicCompatProvider } from '@modules/model/submodules/anthropic-compat/provider'
import { PROVIDER_DISPLAY_NAMES } from '@modules/model/provider-display'

describe('OpenAI-compat catalog (OpenClaw-aligned)', () => {
  it('includes the major OpenClaw OpenAI-compatible providers', () => {
    const ids = new Set(OPENAI_COMPAT_CATALOG.map((p) => p.id))
    for (const id of [
      'xai',
      'mistral',
      'groq',
      'together',
      'deepseek',
      'cerebras',
      'venice',
      'huggingface',
      'nvidia',
      'zai',
      'kilocode',
      'vercel-ai-gateway',
      'qianfan',
      'vllm',
    ]) {
      expect(ids.has(id), `missing ${id}`).toBe(true)
    }
  })

  it('uses OpenClaw base URLs for flagship endpoints', () => {
    const byId = Object.fromEntries(OPENAI_COMPAT_CATALOG.map((p) => [p.id, p]))
    expect(byId.xai.baseURL).toBe('https://api.x.ai/v1')
    expect(byId.mistral.baseURL).toBe('https://api.mistral.ai/v1')
    expect(byId.groq.baseURL).toBe('https://api.groq.com/openai/v1')
    expect(byId.together.baseURL).toBe('https://api.together.xyz/v1')
    expect(byId.venice.baseURL).toBe('https://api.venice.ai/api/v1')
    expect(byId.huggingface.baseURL).toBe('https://router.huggingface.co/v1')
    expect(byId.nvidia.baseURL).toBe('https://integrate.api.nvidia.com/v1')
    expect(byId.zai.baseURL).toBe('https://api.z.ai/api/paas/v4')
    expect(byId.vllm.baseURL).toBe('http://127.0.0.1:8000/v1')
  })

  it('creates listable providers with product names', async () => {
    const def = OPENAI_COMPAT_CATALOG.find((p) => p.id === 'mistral')!
    const p = createCompatProvider(def, 'test-key')
    expect(p.id).toBe('mistral')
    expect(p.name).toBe('Mistral')
    const models = await p.listModels()
    expect(models.some((m) => m.id === 'mistral-large-latest')).toBe(true)
  })

  it('exposes secrets and display names for every cloud entry', () => {
    const secrets = compatSecretMap()
    const names = compatDisplayNames()
    expect(secrets.xai).toBe('xai-api-key')
    expect(names.xai).toBe('xAI')
    expect(PROVIDER_DISPLAY_NAMES.xai).toBe('xAI')
    expect(PROVIDER_DISPLAY_NAMES.mistral).toBe('Mistral')
    expect(PROVIDER_DISPLAY_NAMES.minimax).toBe('MiniMax')
  })
})

describe('Anthropic-compat catalog (OpenClaw-aligned)', () => {
  it('includes MiniMax, Synthetic, Xiaomi with Anthropic base URLs', () => {
    const byId = Object.fromEntries(ANTHROPIC_COMPAT_CATALOG.map((p) => [p.id, p]))
    expect(byId.minimax.baseURL).toBe('https://api.minimax.io/anthropic')
    expect(byId.synthetic.baseURL).toBe('https://api.synthetic.new/anthropic')
    expect(byId.xiaomi.baseURL).toBe('https://api.xiaomimimo.com/anthropic')
  })

  it('builds a MiniMax provider with static models', async () => {
    const def = ANTHROPIC_COMPAT_CATALOG.find((p) => p.id === 'minimax')!
    const p = createAnthropicCompatProvider(def, 'test-key')
    expect(p.name).toBe('MiniMax')
    const models = await p.listModels()
    expect(models[0].provider).toBe('minimax')
  })
})
