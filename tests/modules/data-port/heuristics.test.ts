// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  classifyPath,
  detectProfileFromPaths,
  titleFromPathAndContent,
} from '@modules/data-port/scanners/heuristics'

describe('data-port heuristics', () => {
  it('detects claude-code from CLAUDE.md path', () => {
    expect(detectProfileFromPaths(['project/CLAUDE.md', 'skills/foo.md'])).toBe('claude-code')
  })

  it('detects cursor from .cursorrules', () => {
    expect(detectProfileFromPaths(['.cursorrules', 'src/main.ts'])).toBe('cursor')
  })

  it('detects obsidian from .obsidian folder', () => {
    expect(detectProfileFromPaths(['.obsidian/app.json', 'Notes/foo.md'])).toBe('obsidian')
  })

  it('classifies CLAUDE.md as workspace rules', () => {
    const h = classifyPath('CLAUDE.md', '# Rules\nAlways use TypeScript')
    expect(h.kind).toBe('rule')
    expect(h.target).toBe('workspace.agents')
    expect(h.selectedByDefault).toBe(true)
  })

  it('classifies skill.md under skills/', () => {
    const h = classifyPath(
      'skills/coding/review.md',
      '---\nname: review\ntrigger_patterns: ["review"]\n---\n# Review skill',
    )
    expect(h.kind).toBe('skill')
    expect(h.target).toBe('skill')
  })

  it('classifies MEMORY.md as memory', () => {
    const h = classifyPath('MEMORY.md', '## Preferences\nUser likes dark mode')
    expect(h.kind).toBe('memory')
    expect(h.target).toMatch(/vault\.semantic|episodic/)
  })

  it('skips secrets', () => {
    const h = classifyPath('.env', 'API_KEY=sk-secret-value-here')
    expect(h.kind).toBe('noise')
    expect(h.selectedByDefault).toBe(false)
  })

  it('does not treat vault memory frontmatter as skill', () => {
    const h = classifyPath(
      'ai-memory/feedback_always_check_memory.md',
      '---\nname: Always check memory\ndescription: do not wait for explicit triggers\ntype: feedback\n---\nBody\n',
    )
    expect(h.kind).toBe('memory')
    expect(h.target).not.toBe('skill')
  })

  it('does not flag prose mentioning secret/password as noise', () => {
    const h = classifyPath(
      'ai-memory/project_security_note.md',
      '---\nname: sec\ndescription: gate secrets\ntype: project\n---\nDiscussed password policy and secret handling.\n',
    )
    expect(h.kind).toBe('memory')
  })

  it('extracts title from h1', () => {
    expect(titleFromPathAndContent('notes/x.md', '# Hello World\n\nbody')).toBe('Hello World')
  })
})
