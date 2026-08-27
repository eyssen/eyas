// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSkillGenerator,
  renderSkillMd,
  parseFrontmatter,
  SkillFrontmatterSchema,
} from '../../../src/modules/skill-generation/skill-generator.js'
import type { SkillCandidate } from '../../../src/modules/skill-generation/types.js'

function buildCandidate(): SkillCandidate {
  return {
    id: 'cand-authoring-1',
    fromSessionIds: ['s1', 's2'],
    pattern: {
      name: 'read-grep-write',
      description: 'Read a file, grep a pattern, write a result',
      triggers: ['find the X in file Y', 'search and replace in Z'],
      toolChain: [
        { toolName: 'read', schema: { path: 'string' } },
        { toolName: 'grep', schema: { pattern: 'string' } },
        { toolName: 'write', schema: { path: 'string', body: 'string' } },
      ],
    },
    observations: { timesObserved: 5, averageTurns: 3.2, averageCost: 0.012, successRate: 0.9 },
    proposedBy: 'sleep-time-consolidator',
    createdAt: 1_700_000_000_000,
  }
}

describe('skill authoring pass', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'eyas-skillgen-authoring-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  })

  it('uses the model-authored SKILL.md when the model returns valid JSON', async () => {
    const authored = {
      name: 'read-grep-write',
      description: 'Locate a pattern in a file and replace it with a computed result.',
      whenToInvoke: ['find pattern X in file Y and replace it'],
      body:
        '# read-grep-write\n\nLocate a pattern in a file and replace it with a computed result.\n\n' +
        '## When to invoke\n- find pattern X in file Y and replace it\n\n' +
        '## Tools\n- read\n- grep\n- write\n\n' +
        '## Steps\n1. Read the target file.\n2. Grep for the pattern.\n3. Write the replacement back.\n',
    }
    const complete = vi.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify(authored) }],
    }))
    const gen = createSkillGenerator({ rootDir: tmp, version: '0.1.0' }, { model: { complete } as any })
    const cand = buildCandidate()

    const result = await gen.generate(cand, 1_700_000_001_000)

    expect(complete).toHaveBeenCalled()
    expect(result.skillMdContent).toContain('## Steps')
    expect(result.skillMdContent).toContain('1. Read the target file.')

    const parsed = parseFrontmatter(result.skillMdContent)
    const fm = SkillFrontmatterSchema.parse(parsed)
    expect(fm.description).toBe(authored.description)
    // tools/license/version stay deterministic — never model-authored.
    expect(fm.tools).toEqual(['read', 'grep', 'write'])
    expect(fm.license).toBe('MIT')
    expect(fm.version).toBe('0.1.0')
  })

  it('falls back to the deterministic renderer when the model throws', async () => {
    const complete = vi.fn(async () => {
      throw new Error('boom')
    })
    const gen = createSkillGenerator({ rootDir: tmp, version: '0.1.0' }, { model: { complete } as any })
    const cand = buildCandidate()

    const result = await gen.generate(cand, 1_700_000_001_000)
    const { content: deterministicContent } = renderSkillMd(cand, '0.1.0')
    expect(result.skillMdContent).toBe(deterministicContent)
  })

  it('falls back to the deterministic renderer when the model returns invalid JSON', async () => {
    const complete = vi.fn(async () => ({
      content: [{ type: 'text', text: 'not json at all' }],
    }))
    const gen = createSkillGenerator({ rootDir: tmp, version: '0.1.0' }, { model: { complete } as any })
    const cand = buildCandidate()

    const result = await gen.generate(cand, 1_700_000_001_000)
    const { content: deterministicContent } = renderSkillMd(cand, '0.1.0')
    expect(result.skillMdContent).toBe(deterministicContent)
  })

  it('falls back to the deterministic renderer when the authored frontmatter fails schema validation', async () => {
    const authored = {
      name: 'read-grep-write',
      description: '', // invalid — SkillFrontmatterSchema requires min length 1
      whenToInvoke: ['find pattern X'],
      body: 'some body',
    }
    const complete = vi.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify(authored) }],
    }))
    const gen = createSkillGenerator({ rootDir: tmp, version: '0.1.0' }, { model: { complete } as any })
    const cand = buildCandidate()

    const result = await gen.generate(cand, 1_700_000_001_000)
    const { content: deterministicContent } = renderSkillMd(cand, '0.1.0')
    expect(result.skillMdContent).toBe(deterministicContent)
  })

  it('falls back to the deterministic renderer when no model is configured', async () => {
    const gen = createSkillGenerator({ rootDir: tmp, version: '0.1.0' })
    const cand = buildCandidate()

    const result = await gen.generate(cand, 1_700_000_001_000)
    const { content: deterministicContent } = renderSkillMd(cand, '0.1.0')
    expect(result.skillMdContent).toBe(deterministicContent)
  })
})
