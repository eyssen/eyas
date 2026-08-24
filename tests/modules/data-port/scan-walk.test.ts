// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanDirectory, walkFiles } from '@modules/data-port/scanners/scan-path'

describe('data-port walk + scan real layouts', () => {
  let root: string
  let outside: string

  beforeEach(() => {
    root = join(tmpdir(), `eyas-walk-${Date.now()}`)
    outside = join(tmpdir(), `eyas-walk-out-${Date.now()}`)
    mkdirSync(join(root, '.claude', 'skills', 'demo'), { recursive: true })
    mkdirSync(join(root, '99_Meta', 'ai-memory'), { recursive: true })
    mkdirSync(join(root, 'noise', 'deep'), { recursive: true })
    mkdirSync(outside, { recursive: true })

    writeFileSync(
      join(root, '.claude', 'skills', 'demo', 'SKILL.md'),
      '---\nname: demo\ndescription: d\n---\n# Demo skill\n',
    )
    writeFileSync(join(root, '99_Meta', 'ai-memory', 'MEMORY.md'), '# Memory index\n- note\n')
    writeFileSync(join(root, '99_Meta', 'ai-memory', 'project-x.md'), '# Project X\nfact\n')
    writeFileSync(join(outside, 'linked-memory.md'), '# Linked from vault\n')
    // Symlink like ~/.grok/memory → Obsidian
    symlinkSync(join(outside, 'linked-memory.md'), join(root, '99_Meta', 'ai-memory', 'linked.md'))
    // Noise that should not drown priority if we only take a few files
    for (let i = 0; i < 30; i++) {
      writeFileSync(join(root, 'noise', 'deep', `note-${i}.md`), `# Noise ${i}\n`)
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  it('walks into .claude/skills and follows symlinks', () => {
    const files = walkFiles(root, 100)
    const rel = files.map((f) => f.slice(root.length + 1))
    expect(rel.some((r) => r.includes('.claude/skills') && r.includes('SKILL.md'))).toBe(true)
    expect(rel.some((r) => r.includes('ai-memory') && r.includes('MEMORY.md'))).toBe(true)
    expect(rel.some((r) => r.includes('linked.md'))).toBe(true)
  })

  it('classifies skills and memory correctly', () => {
    const result = scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const kinds = result.candidates.map((c) => c.kind)
    expect(kinds).toContain('skill')
    expect(kinds).toContain('memory')
    const skill = result.candidates.find((c) => c.kind === 'skill')
    expect(skill?.relativePath).toMatch(/SKILL\.md$/i)
  })

  it('prioritizes ai-memory over bulk noise when capped', () => {
    const files = walkFiles(root, 8)
    const joined = files.join('\n')
    expect(joined).toMatch(/ai-memory|SKILL\.md|\.claude/)
  })
})
