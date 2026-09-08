// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createModelRouter } from '@modules/agent/model-router.js'

describe('ModelRouter', () => {
  let router: ReturnType<typeof createModelRouter>

  beforeEach(() => {
    router = createModelRouter()
  })

  describe('model-router default rules', () => {
    it('uses current model ids', () => {
      expect(router.selectModel('architecture', 'complex')).toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' })
      expect(router.selectModel('implementation', 'complex')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
      expect(router.selectModel('lookup', 'trivial')).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5' })
      expect(router.selectModel('unknown', 'unknown')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' })
    })
  })

  describe('selectModel — exact match', () => {
    it('selects opus for complex architecture task', () => {
      const sel = router.selectModel('architecture', 'complex')
      expect(sel.model).toContain('opus')
      expect(sel.provider).toBe('anthropic')
    })

    it('selects sonnet for moderate architecture task', () => {
      const sel = router.selectModel('architecture', 'moderate')
      expect(sel.model).toContain('sonnet')
    })

    it('selects haiku for simple implementation task', () => {
      const sel = router.selectModel('implementation', 'simple')
      expect(sel.model).toContain('haiku')
    })

    it('selects opus for complex review task', () => {
      const sel = router.selectModel('review', 'complex')
      expect(sel.model).toContain('opus')
    })

    it('selects haiku for trivial lookup task', () => {
      const sel = router.selectModel('lookup', 'trivial')
      expect(sel.model).toContain('haiku')
    })
  })

  describe('selectModel — fallback by taskType', () => {
    it('falls back to first rule for taskType when complexity mismatches', () => {
      const sel = router.selectModel('docs', 'complex')
      // No exact match for docs+complex, but docs+moderate exists
      expect(sel.provider).toBe('anthropic')
      expect(sel.model).toBeTruthy()
    })
  })

  describe('selectModel — ultimate fallback', () => {
    it('returns sonnet for unknown taskType and complexity', () => {
      const sel = router.selectModel('completely-unknown', 'whatever')
      expect(sel.model).toContain('sonnet')
      expect(sel.provider).toBe('anthropic')
    })
  })

  describe('overrides', () => {
    it('override takes precedence over default rules', () => {
      router.updateRule('architecture', 'complex', 'openai', 'gpt-4o')
      const sel = router.selectModel('architecture', 'complex')
      expect(sel.provider).toBe('openai')
      expect(sel.model).toBe('gpt-4o')
    })

    it('clearOverrides restores default behavior', () => {
      router.updateRule('architecture', 'complex', 'openai', 'gpt-4o')
      router.clearOverrides()
      const sel = router.selectModel('architecture', 'complex')
      expect(sel.provider).toBe('anthropic')
      expect(sel.model).toContain('opus')
    })

    it('multiple overrides for different keys coexist', () => {
      router.updateRule('architecture', 'complex', 'openai', 'gpt-4o')
      router.updateRule('test', 'simple', 'ollama', 'llama3')

      expect(router.selectModel('architecture', 'complex').model).toBe('gpt-4o')
      expect(router.selectModel('test', 'simple').model).toBe('llama3')
      // Non-overridden still uses default
      expect(router.selectModel('review', 'complex').model).toContain('opus')
    })
  })

  describe('getRoutingTable', () => {
    it('returns a copy of default rules', () => {
      const table = router.getRoutingTable()
      expect(table.length).toBeGreaterThan(0)
      expect(table[0]).toHaveProperty('taskType')
      expect(table[0]).toHaveProperty('complexity')
      expect(table[0]).toHaveProperty('provider')
      expect(table[0]).toHaveProperty('model')
      expect(table[0]).toHaveProperty('reasoning')
    })

    it('modifying returned table does not affect router', () => {
      const table = router.getRoutingTable()
      table.length = 0
      expect(router.getRoutingTable().length).toBeGreaterThan(0)
    })
  })
})
