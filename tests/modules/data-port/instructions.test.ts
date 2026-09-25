// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  applyInstructionHints,
  inferProfileFromInstructions,
  normalizeInstructions,
  parseInstructionHints,
} from '@modules/data-port/scanners/instructions'
import type { ScanCandidate } from '@modules/data-port/types'

function cand(partial: Partial<ScanCandidate> & Pick<ScanCandidate, 'id' | 'relativePath'>): ScanCandidate {
  return {
    kind: 'memory',
    target: 'vault.semantic',
    title: partial.relativePath,
    preview: '',
    bytes: 100,
    confidence: 0.5,
    reason: 'base',
    reasonCode: 'memory-note',
    selectedByDefault: false,
    ...partial,
  }
}

describe('data-port instructions', () => {
  it('normalizes empty to null', () => {
    expect(normalizeInstructions('  ')).toBeNull()
    expect(normalizeInstructions(null)).toBeNull()
  })

  it('parses memory/skills/obsidian/claude hints', () => {
    const h = parseInstructionHints(
      'Claude és Grok memória van elvileg Obsidian alatt és vannak saját skillek a Claude-ban.',
    )
    expect(h.wantsMemory).toBe(true)
    expect(h.wantsSkills).toBe(true)
    expect(h.mentionsObsidian).toBe(true)
    expect(h.mentionsClaude).toBe(true)
    expect(h.mentionsGrok).toBe(true)
  })

  it('boosts matching paths and kinds', () => {
    const list = [
      cand({ id: '1', relativePath: 'random/notes/todo.md', kind: 'knowledge', confidence: 0.4 }),
      cand({
        id: '2',
        relativePath: 'Obsidian/ai-memory/claude-session.md',
        kind: 'memory',
        confidence: 0.55,
      }),
      cand({
        id: '3',
        relativePath: '.claude/skills/deploy/SKILL.md',
        kind: 'skill',
        confidence: 0.6,
      }),
    ]
    const out = applyInstructionHints(
      list,
      'Claude memory under Obsidian; custom skills in Claude',
    )
    const mem = out.find((c) => c.id === '2')!
    const skill = out.find((c) => c.id === '3')!
    const noise = out.find((c) => c.id === '1')!
    expect(mem.confidence).toBeGreaterThan(0.55)
    expect(mem.selectedByDefault).toBe(true)
    expect(skill.confidence).toBeGreaterThan(0.6)
    expect(skill.selectedByDefault).toBe(true)
    expect(noise.confidence).toBeLessThanOrEqual(0.45)
  })

  it('may tick a D-8 row the owner names, and never unticks a selected one', () => {
    const code = cand({ id: 'c1', kind: 'code', reasonCode: 'source-code', relativePath: 'alpha/scripts/deploy.py', selectedByDefault: false, target: 'vault.semantic' })
    const [out] = applyInstructionHints([code], 'import my python scripts under alpha/scripts')
    expect(out.selectedByDefault).toBe(true)
    const note = cand({ id: 'c2', relativePath: 'notes/alpha.md', kind: 'memory', selectedByDefault: true })
    expect(applyInstructionHints([note], 'only skills please')[0].selectedByDefault).toBe(true)
  })

  it('infers obsidian profile from instructions when auto', () => {
    expect(
      inferProfileFromInstructions('auto', 'memories live in Obsidian vault'),
    ).toBe('obsidian')
    expect(inferProfileFromInstructions('claude-code', 'Obsidian stuff')).toBe('claude-code')
  })

  it('names every assistant the registry knows', () => {
    expect(inferProfileFromInstructions('auto', 'my Grok memories')).toBe('grok-cli')
    expect(inferProfileFromInstructions('auto', 'notes from Codex')).toBe('codex')
    expect(inferProfileFromInstructions('auto', 'Gemini CLI history')).toBe('gemini-cli')
    expect(inferProfileFromInstructions('auto', 'rules I keep in Windsurf')).toBe('windsurf')
    expect(inferProfileFromInstructions('auto', 'Copilot instructions')).toBe('copilot')
    expect(inferProfileFromInstructions('auto', 'the Cursor rules folder')).toBe('cursor')
  })

  it('prefers the vault over the assistant when the sentence names both', () => {
    expect(inferProfileFromInstructions('auto', 'Claude memory under Obsidian')).toBe('obsidian')
    expect(inferProfileFromInstructions('auto', 'Grok and Claude notes')).toBe('claude-code')
  })

  it('leaves auto alone when no assistant is named', () => {
    expect(inferProfileFromInstructions('auto', 'import whatever looks durable')).toBe('auto')
    expect(inferProfileFromInstructions('auto', null)).toBe('auto')
  })
})
