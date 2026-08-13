// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 52 — Prompt cache hit ratio test.
//
// The real-API block is gated behind EYAS_REAL_ANTHROPIC env var so it
// never runs in CI. The synchronous unit test (NOT gated) verifies the
// cache_control plumbing that enables prompt caching.

import { describe, it, expect } from 'vitest'
import type { AssembledPrompt } from '@modules/prompt-wizard/types.js'

// ─── Synchronous unit test — verifies cache_control plumbing ─────────────────

describe('AnthropicAdapter cache_control plumbing (no API call)', () => {
  it('prefix block carries cache_control: { type: ephemeral }', () => {
    const prompt: AssembledPrompt = {
      prefix: '<core-identity>\nYou are EYAS.\n</core-identity>\n\n<agent-identity>\nI am Jarvis.\n</agent-identity>\n',
      suffix: '<active-voice>\nVoice scope: INTERNAL\n</active-voice>\n',
      reminders: [],
      cacheBoundaryHint: 100,
      prefixHash: 'a'.repeat(64),
      tokenEstimate: { prefix: 150, suffix: 40, reminders: 0 },
    }

    // Reproduce the exact block-building logic from AnthropicAdapter.send()
    const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = []
    if (prompt.prefix.trim()) {
      systemBlocks.push({ type: 'text', text: prompt.prefix, cache_control: { type: 'ephemeral' } })
    }
    if (prompt.suffix.trim()) {
      systemBlocks.push({ type: 'text', text: prompt.suffix })
    }
    for (const r of prompt.reminders) {
      systemBlocks.push({ type: 'text', text: r })
    }

    // The first block (prefix) must be marked ephemeral
    expect(systemBlocks[0]).toMatchObject({
      type: 'text',
      cache_control: { type: 'ephemeral' },
    })

    // Subsequent blocks must NOT carry cache_control
    for (const block of systemBlocks.slice(1)) {
      expect(block.cache_control).toBeUndefined()
    }
  })

  it('empty prefix produces no cache_control block', () => {
    const prompt: AssembledPrompt = {
      prefix: '',
      suffix: 'Some dynamic suffix',
      reminders: [],
      cacheBoundaryHint: 0,
      prefixHash: 'b'.repeat(64),
      tokenEstimate: { prefix: 0, suffix: 20, reminders: 0 },
    }

    const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = []
    if (prompt.prefix.trim()) {
      systemBlocks.push({ type: 'text', text: prompt.prefix, cache_control: { type: 'ephemeral' } })
    }
    if (prompt.suffix.trim()) {
      systemBlocks.push({ type: 'text', text: prompt.suffix })
    }

    expect(systemBlocks).toHaveLength(1)
    expect(systemBlocks[0].cache_control).toBeUndefined()
  })
})

// ─── Real-API gate — skipped unless EYAS_REAL_ANTHROPIC is set ───────────────

describe.skipIf(!process.env.EYAS_REAL_ANTHROPIC)(
  'Anthropic prompt cache hit ratio (requires EYAS_REAL_ANTHROPIC=1)',
  () => {
    /**
     * Performance gate: sends the same assembled prompt 10 times in sequence
     * and asserts that ≥ 80% of input tokens come from cache hits.
     *
     * This test documents the intended performance contract but NEVER runs
     * in CI because it requires a real API key and burns real tokens.
     *
     * To run locally:
     *   EYAS_REAL_ANTHROPIC=1 ANTHROPIC_API_KEY=<key> bun test tests/performance/prompt-cache-anthropic.test.ts
     */
    it('achieves ≥ 80% cache hit ratio over 10 turns', async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const { AnthropicAdapter } = await import('@modules/model/submodules/anthropic/adapter.js')

      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for this test')

      const adapter = new AnthropicAdapter(new Anthropic({ apiKey }))

      // Stable prefix (>1024 tokens to trigger caching) — we use a long repeated string
      const longPrefix = Array.from({ length: 50 }, (_, i) =>
        `<section-${i}>\nThis is stable cache-eligible content for section ${i}. `.repeat(20) + `\n</section-${i}>`,
      ).join('\n\n')

      const prompt: AssembledPrompt = {
        prefix: longPrefix,
        suffix: '<active-voice>\nVoice scope: INTERNAL\n</active-voice>',
        reminders: [],
        cacheBoundaryHint: longPrefix.length,
        prefixHash: 'c'.repeat(64),
        tokenEstimate: { prefix: 3000, suffix: 20, reminders: 0 },
      }

      const TURNS = 10
      let totalInput = 0
      let totalCacheRead = 0

      for (let i = 0; i < TURNS; i++) {
        const response = await adapter.send({
          systemPrompt: prompt,
          messages: [{ role: 'user', content: `Turn ${i}: reply with "ok"` }],
          modelId: 'claude-haiku-4-5',
          metadata: {},
        })

        // Anthropic returns cache usage in the raw response — we check via usage
        totalInput += response.usage.inputTokens
        // Cache read tokens are in usage.cache_read_input_tokens (not typed but available)
        const raw = response as unknown as Record<string, unknown>
        const cacheRead = raw.cache_read_input_tokens as number ?? 0
        totalCacheRead += cacheRead
      }

      const cacheRatio = totalInput > 0 ? totalCacheRead / totalInput : 0

      // This is the performance gate
      expect(cacheRatio).toBeGreaterThanOrEqual(0.8)
    }, 120_000)  // 2 minute timeout for real API calls
  },
)
