// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { applyMemoryItem } from '@modules/data-port/pipeline/apply'
import { safeImportedKind } from '@modules/data-port/pipeline/transform'

describe('data-port apply memory', () => {
  it('clamps unknown kind to reference and never invents user', () => {
    expect(safeImportedKind(undefined)).toBe('reference')
    expect(safeImportedKind('owner')).toBe('reference')
    expect(safeImportedKind('user')).toBe('user')
    expect(safeImportedKind('feedback')).toBe('feedback')
  })

  it('skips MEMORY.md indexes even if the wizard asked to import them', async () => {
    const written: Array<{ path: string; fm: Record<string, unknown> }> = []
    const result = await applyMemoryItem(
      {
        vault: {
          write: (path, fm) => {
            written.push({ path, fm })
          },
          exists: () => false,
        },
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
      },
      {
        jobId: 'job-1',
        sourceProfile: 'claude-code',
        target: 'vault.semantic',
        relativePath: '.grok/memory/MEMORY.md',
        sourceContent: '# Memory\n- [[alpha]]\n- [[bravo]]\n',
        transformed: {
          kind: 'user',
          title: 'Memory Index',
          body: '- [[alpha]]\n- [[bravo]]',
          tags: [],
          links: [],
          salience: 0.7,
          summary_one_line: 'index',
        },
      },
    )
    expect(result.status).toBe('skipped')
    expect(written).toHaveLength(0)
  })

  it('writes kind reference on a durable vault copy', async () => {
    const written: Array<{ path: string; fm: Record<string, unknown> }> = []
    const result = await applyMemoryItem(
      {
        vault: {
          write: (path, fm) => {
            written.push({ path, fm })
          },
          exists: () => false,
        },
        createProposal: () => 'p',
        resolveDefaultAgentId: () => 'a',
      },
      {
        jobId: 'job-1',
        sourceProfile: 'obsidian',
        target: 'vault.semantic',
        relativePath: 'ai-memory/alpha-pref.md',
        sourceContent: 'Prefer concise answers.',
        transformed: {
          kind: 'reference',
          title: 'Prefer concise answers',
          body: 'Prefer concise answers.',
          tags: [],
          links: [],
          salience: 0.7,
          summary_one_line: 'Prefer concise answers.',
        },
      },
    )
    expect(result.status).toBe('applied')
    expect(written[0]?.fm.kind).toBe('reference')
  })
})
