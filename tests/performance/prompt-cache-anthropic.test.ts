// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 52 — Prompt cache hit ratio gate for the Anthropic API provider.
//
// Gated behind EYAS_REAL_ANTHROPIC so it never runs in CI: it needs a real API
// key and burns real tokens. It measures the production path —
// createAnthropicProvider().complete(), the provider the model module
// registers — not a test-only adapter. The provider puts a cache breakpoint
// on the (turn-stable) system prompt plus top-level automatic caching, so from
// the second call on the shared system prompt is read from the cache even
// though each call's user message differs.

import { describe, it, expect } from 'vitest'

describe.skipIf(!process.env.EYAS_REAL_ANTHROPIC)(
  'Anthropic prompt cache hit ratio (requires EYAS_REAL_ANTHROPIC=1)',
  () => {
    /**
     * Sends the same stable system prompt 10 times in sequence and asserts
     * that ≥ 80% of all input tokens were read from the cache.
     *
     * To run locally:
     *   EYAS_REAL_ANTHROPIC=1 ANTHROPIC_API_KEY=<key> bun vitest run tests/performance/prompt-cache-anthropic.test.ts
     */
    it('achieves ≥ 80% cache hit ratio over 10 turns', async () => {
      const { createAnthropicProvider } = await import('@modules/model/submodules/anthropic/provider.js')

      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for this test')

      const provider = createAnthropicProvider(apiKey)

      // Stable system prompt (well over the minimum cacheable length).
      const system = Array.from({ length: 50 }, (_, i) =>
        `<section-${i}>\nThis is stable cache-eligible content for section ${i}. `.repeat(20) + `\n</section-${i}>`,
      ).join('\n\n')

      const TURNS = 10
      let totalInput = 0
      let totalCacheRead = 0

      for (let i = 0; i < TURNS; i++) {
        const response = await provider.complete({
          model: 'claude-haiku-4-5',
          system,
          messages: [{ role: 'user', content: `Turn ${i}: reply with "ok"` }],
          maxTokens: 16,
        })

        // Anthropic's input_tokens excludes the cached part: the whole input
        // is uncached + cache-write + cache-read tokens.
        const { inputTokens, cacheReadTokens = 0, cacheCreationTokens = 0 } = response.usage
        totalInput += inputTokens + cacheReadTokens + cacheCreationTokens
        totalCacheRead += cacheReadTokens
      }

      const cacheRatio = totalInput > 0 ? totalCacheRead / totalInput : 0

      // This is the performance gate.
      expect(cacheRatio).toBeGreaterThanOrEqual(0.8)
    }, 120_000) // 2 minute timeout for real API calls
  },
)
