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
    mkdirSync(join(root, '99_Meta', 'claude-sessions', '2026-08'), { recursive: true })
    writeFileSync(
      join(root, '99_Meta', 'claude-sessions', '2026-08', 'chat.md'),
      '---\ntype: claude-session\n---\n# dump\n',
    )
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
    expect(result.candidates.some((c) => c.relativePath.includes('claude-sessions'))).toBe(false)
  })

  it('prioritizes ai-memory over bulk noise when capped', () => {
    const files = walkFiles(root, 8)
    const joined = files.join('\n')
    expect(joined).toMatch(/ai-memory|SKILL\.md|\.claude/)
  })
})

describe('data-port walk of a home-sized root', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `eyas-homewalk-${Date.now()}`)
    mkdirSync(join(root, '.grok', 'memory'), { recursive: true })
    mkdirSync(join(root, 'Documents', 'Obsidian Vault', '99_Meta', 'ai-memory'), { recursive: true })
    mkdirSync(join(root, 'GitHub', 'alpha', 'src'), { recursive: true })
    writeFileSync(join(root, '.grok', 'memory', 'alpha-note.md'), '# grok fact\n')
    writeFileSync(
      join(root, 'Documents', 'Obsidian Vault', '99_Meta', 'ai-memory', 'obsidian-fact.md'),
      '---\nname: fact\ndescription: d\ntype: feedback\n---\nA durable note.\n',
    )
    writeFileSync(join(root, 'GitHub', 'alpha', 'src', 'README.md'), '# repo\n')
    for (let i = 0; i < 80; i++) {
      mkdirSync(join(root, 'GitHub', 'alpha', `pkg-${i}`), { recursive: true })
      writeFileSync(join(root, 'GitHub', 'alpha', `pkg-${i}`, 'note.md'), `# pkg ${i}\n`)
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reaches Documents/ai-memory and skips GitHub when the root looks like $HOME', () => {
    const files = walkFiles(root, 500)
    const rel = files.map((f) => f.slice(root.length + 1).replace(/\\/g, '/'))
    expect(rel.some((r) => r.includes('ai-memory') && r.endsWith('obsidian-fact.md'))).toBe(true)
    expect(rel.some((r) => r.includes('.grok/memory') && r.endsWith('alpha-note.md'))).toBe(true)
    expect(rel.some((r) => r.startsWith('GitHub/'))).toBe(false)
  })
})
