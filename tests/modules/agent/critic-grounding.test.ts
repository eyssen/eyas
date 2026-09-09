import { describe, it, expect } from 'vitest'
import {
  deterministicGroundingCheck,
  isRetrievalTool,
  parseCriticVerdict,
} from '@modules/agent/critic'

describe('F3 grounding critic', () => {
  it('flags research goals without retrieval evidence', () => {
    const result = deterministicGroundingCheck({
      goal: 'Research how authentication works in the codebase and cite sources',
      transcript: 'I think auth uses JWT. Done.',
    })
    expect(result).not.toBeNull()
    expect(result!.verdict).toBe('incomplete')
    expect(result!.missing.some((m) => /source/i.test(m))).toBe(true)
  })

  it('flags implement/fix goals without retrieval evidence', () => {
    const implement = deterministicGroundingCheck({
      goal: 'Implement OAuth in the auth module',
      transcript: 'I added OAuth based on common patterns. Done.',
    })
    expect(implement).not.toBeNull()
    expect(implement!.verdict).toBe('incomplete')

    const fix = deterministicGroundingCheck({
      goal: 'Fix the null pointer in order service',
      transcript: 'Fixed NPE by adding a null check.',
    })
    expect(fix).not.toBeNull()
    expect(fix!.verdict).toBe('incomplete')
  })

  it('passes when [source:…] citations are present', () => {
    const result = deterministicGroundingCheck({
      goal: 'Research the billing module',
      transcript: 'Billing lives in modules/billing [source:chunk-abc]. search_indexed returned 3 hits.',
    })
    expect(result).toBeNull()
  })

  it('passes when retrievalUsed is true', () => {
    const result = deterministicGroundingCheck({
      goal: 'Look up the deploy runbook',
      transcript: 'Found the runbook.',
      retrievalUsed: true,
    })
    expect(result).toBeNull()
  })

  it('passes implement goals when retrievalUsed is true (runner toolCalls path)', () => {
    const result = deterministicGroundingCheck({
      goal: 'Implement rate limiting on the API gateway',
      transcript: 'Added a token-bucket middleware matching existing patterns.',
      retrievalUsed: true,
    })
    expect(result).toBeNull()
  })

  it('ignores non-grounding goals', () => {
    const result = deterministicGroundingCheck({
      goal: 'Write a haiku about rain',
      transcript: 'soft rain falls quietly',
    })
    expect(result).toBeNull()
  })

  it('isRetrievalTool recognizes search tools only', () => {
    expect(isRetrievalTool('search_indexed')).toBe(true)
    expect(isRetrievalTool('search_memory')).toBe(true)
    expect(isRetrievalTool('get_page')).toBe(true)
    expect(isRetrievalTool('list_search_sources')).toBe(false)
    expect(isRetrievalTool('run_command')).toBe(false)
  })

  it('parseCriticVerdict still works', () => {
    const v = parseCriticVerdict('{"verdict":"complete","reason":"ok","missing":[]}')
    expect(v?.verdict).toBe('complete')
  })
})
