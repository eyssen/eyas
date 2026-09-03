// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSkillGenerator,
  renderFrontmatter,
  renderSkillMd,
  parseFrontmatter,
  SkillFrontmatterSchema,
} from '../../../src/modules/skill-generation/skill-generator.js'
import type { SkillCandidate } from '../../../src/modules/skill-generation/types.js'

function buildCandidate(slug = 'read-grep-write'): SkillCandidate {
  return {
    id: 'cand-123',
    fromSessionIds: ['s1', 's2', 's3'],
    pattern: {
      name: slug,
      description: 'Read a file, grep a pattern, write a result',
      triggers: ['find the X in file Y', 'search and replace in Z'],
      toolChain: [
        { toolName: 'read', schema: { path: 'string' } },
        { toolName: 'grep', schema: { pattern: 'string' } },
        { toolName: 'write', schema: { path: 'string', body: 'string' } },
      ],
    },
    observations: {
      timesObserved: 5,
      averageTurns: 3.2,
      averageCost: 0.012,
      successRate: 0.9,
    },
    proposedBy: 'sleep-time-consolidator',
    createdAt: 1_700_000_000_000,
  }
}

describe('renderFrontmatter + parseFrontmatter round-trip', () => {
  it('renders valid frontmatter and round-trips through Zod', () => {
    const cand = buildCandidate()
    const { frontmatter, content } = renderSkillMd(cand, '0.1.0')
    expect(content.startsWith('---\n')).toBe(true)
    expect(content).toContain('license: MIT')
    const parsed = parseFrontmatter(content)
    // Re-validate with Zod
    const reValidated = SkillFrontmatterSchema.parse(parsed)
    expect(reValidated.name).toBe(frontmatter.name)
    expect(reValidated.license).toBe('MIT')
    expect(reValidated.tools).toEqual(['read', 'grep', 'write'])
    expect(reValidated.whenToInvoke.length).toBeGreaterThan(0)
  })

  it('escapes quotes in description', () => {
    const cand = buildCandidate()
    cand.pattern.description = 'Says "hi"'
    const fm = {
      name: cand.pattern.name,
      description: cand.pattern.description,
      whenToInvoke: ['say hi'],
      tools: ['read'],
      license: 'MIT' as const,
      version: '0.1.0',
    }
    const rendered = renderFrontmatter(fm)
    expect(rendered).toContain('Says \\"hi\\"')
  })

  it('handles empty tools list with []', () => {
    const fm = {
      name: 'noop',
      description: 'n',
      whenToInvoke: ['trigger'],
      tools: [],
      license: 'MIT' as const,
      version: '0.1.0',
    }
    const rendered = renderFrontmatter(fm)
    expect(rendered).toContain('tools: []')
    const parsed = parseFrontmatter(`${rendered}\n\nbody`) as { tools: unknown }
    expect(parsed.tools).toEqual([])
  })
})

describe('createSkillGenerator writes files', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'eyas-skillgen-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  })

  it('materialises SKILL.md and metadata.json under rootDir/<slug>/', async () => {
    const gen = createSkillGenerator({ rootDir: tmp, version: '0.2.0' })
    const cand = buildCandidate()
    const result = await gen.generate(cand, 1_700_000_001_000)

    expect(result.slug).toBe('read-grep-write')
    expect(result.directory).toBe(join(tmp, 'read-grep-write'))
    expect(result.skillMdPath.endsWith('SKILL.md')).toBe(true)
    expect(result.metadataPath.endsWith('metadata.json')).toBe(true)

    const mdContent = await readFile(result.skillMdPath, 'utf-8')
    expect(mdContent).toContain('# read-grep-write')
    expect(mdContent).toContain('## Tools')
    expect(mdContent).toContain('**read** — inputs: path')

    const metaContent = await readFile(result.metadataPath, 'utf-8')
    const meta = JSON.parse(metaContent) as { version: string; adoptionStatus: string; candidateId: string }
    expect(meta.version).toBe('0.2.0')
    expect(meta.adoptionStatus).toBe('pending-experiment')
    expect(meta.candidateId).toBe('cand-123')
  })

  it('validates frontmatter with Zod and rejects bad input', async () => {
    const gen = createSkillGenerator({ rootDir: tmp })
    const cand = buildCandidate()
    cand.pattern.name = '' // invalid
    await expect(gen.generate(cand)).rejects.toThrow()
  })
})

describe('renderFrontmatter — quoting of model-authored values', () => {
  it('escapes a backslash so it cannot cancel the closing quote', () => {
    const out = renderFrontmatter({
      name: 'ends-with-backslash\\',
      description: 'd',
      license: 'MIT',
      version: '1.0.0',
      whenToInvoke: ['t'],
      tools: [],
    } as never)
    const nameLine = out.split('\n').find((l) => l.startsWith('name:')) ?? ''
    // A lone trailing backslash would escape the quote and merge the next line.
    expect(nameLine).toBe('name: "ends-with-backslash\\\\"')
    expect(out.split('\n').filter((l) => l.startsWith('description:'))).toHaveLength(1)
  })
})
