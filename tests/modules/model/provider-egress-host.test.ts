// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D2 — every provider that sends to a configurable endpoint reports that
// endpoint's host (the locality fact privacy decides on); fixed-cloud and CLI
// providers report nothing, which privacy treats as remote.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createOllamaProvider } from '@modules/model/submodules/ollama/provider'
import { createLMStudioProvider } from '@modules/model/submodules/lmstudio/provider'
import { createOpenAIProvider } from '@modules/model/submodules/openai/provider'
import { createCompatProvider } from '@modules/model/submodules/openai-compat/provider'
import { OPENAI_COMPAT_CATALOG } from '@modules/model/submodules/openai-compat/catalog'
import { createAnthropicCompatProvider } from '@modules/model/submodules/anthropic-compat/provider'
import { ANTHROPIC_COMPAT_CATALOG } from '@modules/model/submodules/anthropic-compat/catalog'
import { createKimiProvider } from '@modules/model/submodules/kimi/provider'
import { createOpenRouterProvider } from '@modules/model/submodules/openrouter/provider'
import { createAnthropicProvider } from '@modules/model/submodules/anthropic/provider'
import { createGeminiProvider } from '@modules/model/submodules/gemini/provider'
import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider'
import { isLoopbackHost } from '@shared/endpoint-locality'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('local runtimes', () => {
  it('ollama reports OLLAMA_HOST\'s host, localhost by default', () => {
    vi.stubEnv('OLLAMA_HOST', 'http://gpu:11434')
    expect(createOllamaProvider().egressHost?.()).toBe('gpu')
    vi.stubEnv('OLLAMA_HOST', undefined)
    expect(createOllamaProvider().egressHost?.()).toBe('localhost')
    expect(isLoopbackHost(createOllamaProvider().egressHost?.())).toBe(true)
  })

  it('ollama prefers the explicit base URL over OLLAMA_HOST', () => {
    vi.stubEnv('OLLAMA_HOST', 'http://gpu:11434')
    expect(createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434' }).egressHost?.()).toBe('127.0.0.1')
  })

  it('a remote or scheme-less OLLAMA_HOST is never local', () => {
    vi.stubEnv('OLLAMA_HOST', 'http://0.0.0.0:11434')
    expect(isLoopbackHost(createOllamaProvider().egressHost?.())).toBe(false)
    // Scheme-less host:port has no parseable host: unknown, so remote.
    vi.stubEnv('OLLAMA_HOST', 'gpu.lan:11434')
    expect(createOllamaProvider().egressHost?.()).toBeUndefined()
  })

  it('lmstudio reports LM_STUDIO_URL\'s host, localhost by default', () => {
    vi.stubEnv('LM_STUDIO_URL', undefined)
    expect(createLMStudioProvider().egressHost?.()).toBe('localhost')
    vi.stubEnv('LM_STUDIO_URL', 'http://192.168.1.20:1234')
    expect(createLMStudioProvider().egressHost?.()).toBe('192.168.1.20')
    expect(createLMStudioProvider({ baseUrl: 'http://[::1]:1234' }).egressHost?.()).toBe('::1')
  })
})

describe('API providers with a configurable endpoint', () => {
  it('openai reports the SDK\'s resolved base URL host', () => {
    vi.stubEnv('OPENAI_BASE_URL', undefined)
    expect(createOpenAIProvider({ apiKey: 'k' }).egressHost?.()).toBe('api.openai.com')
    expect(createOpenAIProvider({ apiKey: 'k', baseURL: 'http://localhost:8080/v1' }).egressHost?.()).toBe('localhost')
    vi.stubEnv('OPENAI_BASE_URL', 'https://proxy.example.net/v1')
    expect(createOpenAIProvider({ apiKey: 'k' }).egressHost?.()).toBe('proxy.example.net')
  })

  it('openai-compat reports its custom base URL host and its catalog default otherwise', () => {
    const xai = OPENAI_COMPAT_CATALOG.find((d) => d.id === 'xai')!
    expect(createCompatProvider(xai, 'k').egressHost?.()).toBe('api.x.ai')
    expect(createCompatProvider({ ...xai, baseURL: 'http://my-gateway.internal:4000/v1' }, 'k').egressHost?.()).toBe('my-gateway.internal')
    const local = OPENAI_COMPAT_CATALOG.find((d) => d.local)!
    expect(isLoopbackHost(createCompatProvider(local, '').egressHost?.())).toBe(true)
  })

  it('anthropic-compat reports its base URL host', () => {
    const def = ANTHROPIC_COMPAT_CATALOG[0]
    expect(createAnthropicCompatProvider(def, 'k').egressHost?.()).toBe(new URL(def.baseURL).hostname)
    expect(createAnthropicCompatProvider({ ...def, baseURL: 'http://127.0.0.1:9000/anthropic' }, 'k').egressHost?.()).toBe('127.0.0.1')
  })

  it('kimi reports the Moonshot host by default and a configured base URL otherwise', () => {
    expect(createKimiProvider('k').egressHost?.()).toBe('api.moonshot.ai')
    expect(createKimiProvider('k', 'https://api.moonshot.cn/v1').egressHost?.()).toBe('api.moonshot.cn')
  })

  it('openrouter inherits the host from its OpenAI base (remote)', () => {
    const host = createOpenRouterProvider('k').egressHost?.()
    expect(host).toBe('openrouter.ai')
    expect(isLoopbackHost(host)).toBe(false)
  })
})

describe('fixed-cloud and CLI providers', () => {
  it('report no egress host (treated as remote)', () => {
    expect(createAnthropicProvider('k').egressHost?.()).toBeUndefined()
    expect(createGeminiProvider('k').egressHost?.()).toBeUndefined()
    expect(createClaudeCodeProvider().egressHost?.()).toBeUndefined()
    expect(createGrokCliProvider().egressHost?.()).toBeUndefined()
    expect(createKimiCliProvider().egressHost?.()).toBeUndefined()
  })
})
