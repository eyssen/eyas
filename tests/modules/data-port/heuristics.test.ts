// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  classifyPath,
  detectProfileFromPaths,
  titleFromPathAndContent,
} from '@modules/data-port/scanners/heuristics'

describe('data-port heuristics', () => {
  it('detects claude-code from a root CLAUDE.md or .claude/', () => {
    expect(detectProfileFromPaths(['CLAUDE.md', 'skills/foo.md'])).toBe('claude-code')
    expect(detectProfileFromPaths(['.claude/settings.json', 'notes/a.md'])).toBe('claude-code')
  })

  it('does not treat a nested checkout CLAUDE.md as the whole tree being claude-code', () => {
    expect(detectProfileFromPaths(['GitHub/alpha/CLAUDE.md', 'GitHub/alpha/README.md'])).toBe('generic-md')
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

  it('skips MEMORY.md index files instead of importing them as one note', () => {
    const index = classifyPath(
      '.grok/memory/MEMORY.md',
      '# Memory\n\n- [[alpha-note]]\n- [[bravo-note]]\n',
    )
    expect(index.kind).toBe('noise')
    expect(index.selectedByDefault).toBe(false)

    const vaultIndex = classifyPath(
      '99_Meta/ai-memory/MEMORY.md',
      '# Index\n- one-line pointer\n- another pointer\n',
    )
    expect(vaultIndex.kind).toBe('noise')
  })

  it('imports a durable note under an assistant memory path', () => {
    const h = classifyPath(
      '.grok/memory/alpha-pref.md',
      '---\nname: pref\ndescription: how to work\ntype: feedback\n---\nPrefer concise answers.\n',
    )
    expect(h.kind).toBe('memory')
    expect(h.selectedByDefault).toBe(true)
  })

  it('skips claude-sessions transcripts — they are chat logs, not durable notes', () => {
    const h = classifyPath(
      'Documents/Obsidian Vault/99_Meta/claude-sessions/2026-08/foo.md',
      '---\ntype: claude-session\n---\n# chat\nuser said hello\n',
    )
    expect(h.kind).toBe('noise')
    expect(h.selectedByDefault).toBe(false)
  })

  it('skips product docs, robots.txt, and how-to files outside a memory vault', () => {
    expect(classifyPath('.grok/docs/user-guide/13-memory.md', '# Cross-Session Memory\nGrok indexes…').kind).toBe('noise')
    expect(
      classifyPath(
        'GitHub/flutter/docs/howto.md',
        '# How to embed Flutter\nprocedure for adding a view\n',
      ).kind,
    ).toBe('noise')
    expect(
      classifyPath(
        'shop/robots.txt',
        'See http://www.robotstxt.org/robotstxt.html for documentation on how to use\nUser-agent: *\n',
      ).kind,
    ).toBe('noise')
  })

  it('does not treat a random repo AGENTS.md as a workspace import', () => {
    const h = classifyPath('GitHub/alpha/AGENTS.md', '# Project instructions\nAlways write tests.')
    expect(h.kind).toBe('noise')
    expect(h.selectedByDefault).toBe(false)
  })

  it('does not treat config/skills in a product checkout as importable skills', () => {
    const h = classifyPath(
      'GitHub/alpha/config/skills/demo.md',
      '---\nname: demo\ntrigger_patterns: ["demo"]\n---\n# Demo\n',
    )
    expect(h.kind).not.toBe('skill')
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
