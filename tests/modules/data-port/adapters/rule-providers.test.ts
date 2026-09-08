// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { classifyFile } from '@modules/data-port/adapters/registry'
import { cursorAdapter } from '@modules/data-port/adapters/cursor'
import { geminiCliAdapter } from '@modules/data-port/adapters/gemini-cli'
import { windsurfAdapter } from '@modules/data-port/adapters/windsurf'
import { copilotAdapter } from '@modules/data-port/adapters/copilot'

describe('cursor adapter', () => {
  it('detects .cursor trees and .cursorrules', () => {
    expect(cursorAdapter.detect(['.cursor/rules/a.mdc'])).toBeGreaterThan(0.5)
    expect(cursorAdapter.detect(['.cursorrules'])).toBeGreaterThan(0.5)
    expect(cursorAdapter.detect(['x.md'])).toBe(0)
  })
  it('classifies .mdc rules with alwaysApply as global rules and scoped ones as rules too', () => {
    expect(cursorAdapter.classify('.cursor/rules/alpha.mdc', '---\ndescription: d\nalwaysApply: true\n---\n# r'))
      .toMatchObject({ kind: 'rule', target: 'workspace.agents', selectedByDefault: true, reasonCode: 'cursor-rule' })
    const scoped = cursorAdapter.classify('.cursor/rules/py.mdc', '---\nglobs: ["**/*.py"]\n---\n# r')
    expect(scoped?.reason).toMatch(/globs/)
    expect(scoped).toMatchObject({ kind: 'rule', reasonCode: 'cursor-rule', scope: '**/*.py' })
  })
  it('treats a string alwaysApply of "yes" as always-apply too', () => {
    const hint = cursorAdapter.classify('.cursor/rules/alpha.mdc', '---\nalwaysApply: "yes"\n---\n# r')
    expect(hint).toMatchObject({ kind: 'rule', reasonCode: 'cursor-rule' })
    expect(hint?.reason).toMatch(/alwaysApply/)
  })
  it('classifies skills-cursor SKILL.md as skill and agent transcripts as ticked sessions', () => {
    expect(cursorAdapter.classify('.cursor/skills-cursor/shell/SKILL.md', '# Run')?.kind).toBe('skill')
    expect(cursorAdapter.classify('.cursor/projects/p/agent-transcripts/abc/abc.jsonl', '{"role":"user"}'))
      .toMatchObject({ kind: 'session', target: 'episodic', selectedByDefault: true, reasonCode: 'transcript' })
  })

  // A vault that holds a repo is still that repo's tree: the rule file says
  // whose it is, and an Obsidian pick must not relabel it (C1).
  it('keeps a repo rule inside a vault with the Cursor adapter, scope and all', () => {
    const { hint, adapterId } = classifyFile(
      'GitHub/alpha/.cursor/rules/py.mdc',
      '---\ndescription: d\nglobs: **/*.py\n---\n# r',
      'obsidian',
    )
    expect(adapterId).toBe('cursor')
    expect(hint).toMatchObject({ kind: 'rule', reasonCode: 'cursor-rule', scope: '**/*.py', selectedByDefault: true })
  })
  it('classifies a root-level .cursorrules as a rule through classify(), not only detect()', () => {
    expect(cursorAdapter.classify('.cursorrules', '# rules')).toMatchObject({ kind: 'rule', target: 'workspace.agents', reasonCode: 'cursor-rule' })
  })
  it('treats a nested .cursorrules (not at repo root) as a rule too', () => {
    expect(cursorAdapter.detect(['packages/foo/.cursorrules'])).toBeGreaterThan(0.5)
    expect(cursorAdapter.classify('packages/foo/.cursorrules', '# r'))
      .toMatchObject({ kind: 'rule', target: 'workspace.agents', reasonCode: 'cursor-rule' })
  })
  it('recovers globs and alwaysApply from an invalid-YAML frontmatter block (unquoted glob)', () => {
    const hint = cursorAdapter.classify(
      '.cursor/rules/py.mdc',
      '---\ndescription: d\nglobs: **/*.py\nalwaysApply: false\n---\n# r',
    )
    expect(hint).toMatchObject({ kind: 'rule', reasonCode: 'cursor-rule', scope: '**/*.py' })
  })
  it('reads a quoted-string globs value the same way as the array form', () => {
    const hint = cursorAdapter.classify('.cursor/rules/py.mdc', '---\nglobs: "**/*.py"\n---\n# r')
    expect(hint).toMatchObject({ kind: 'rule', reasonCode: 'cursor-rule', scope: '**/*.py' })
  })
  // `expand` is asked of the adapter that CLAIMED the file, and a scan rooted
  // inside the tree hands it a path whose leading segments are gone. These two
  // go straight at `expand` rather than through the scanner, so the segment
  // anchor is pinned by a test of its own (IMP-1).
  it('expands a transcript whose leading segments a rooted scan cut off', () => {
    const raw = Buffer.from('{"role":"user","content":"hi"}\n{"role":"assistant","content":"hello"}\n')
    const units = cursorAdapter.expand!('agent-transcripts/abc.jsonl', raw)
    expect(units).toHaveLength(1)
    // The title comes from the conversation; the file name is still the id.
    expect(units[0]).toMatchObject({ unit: 'transcript', title: 'hi', sessionId: 'abc' })
    expect(units[0]!.hint?.reasonCode).toBe('transcript')
    expect(units[0]!.content).toContain('hello')
  })
  // P-5: a sub-agent transcript is a session of its own, and says which session
  // ran it instead of disappearing into that session's note.
  it('gives a sub-agent transcript a row of its own, tagged with the session that ran it', () => {
    const raw = Buffer.from('{"role":"user","content":"hi"}\n')
    const [unit] = cursorAdapter.expand!('.cursor/projects/bravo/agent-transcripts/abc/subagents/x.jsonl', raw)
    expect(unit!.tags).toEqual(expect.arrayContaining(['cursor-project:bravo', 'subagent', 'parent-session:abc']))
    expect(unit!.data).toMatchObject({ project: 'bravo', parentSession: 'abc', subagent: true })
    const [plain] = cursorAdapter.expand!('.cursor/projects/bravo/agent-transcripts/abc/abc.jsonl', raw)
    expect(plain!.tags).toEqual(['cursor-project:bravo'])
  })
  it('renders nothing for a near-miss the segment anchor must not claim', () => {
    const raw = Buffer.from('{"role":"user","content":"hi"}\n')
    expect(cursorAdapter.expand!('not-agent-transcripts/x.jsonl', raw)).toEqual([])
  })
  it('leaves non-cursor paths to the next adapter', () => {
    expect(cursorAdapter.classify('notes/a.md', 'x')).toBeNull()
    expect(cursorAdapter.classify('.claude/CLAUDE.md', '# rules')).toBeNull()
    expect(cursorAdapter.classify('src/app.ts', 'x')).toBeNull()
    expect(cursorAdapter.detect(['notes/a.md'])).toBe(0)
    expect(cursorAdapter.detect(['.claude/CLAUDE.md'])).toBe(0)
    expect(cursorAdapter.detect(['src/app.ts'])).toBe(0)
  })
})

describe('gemini-cli adapter', () => {
  it('detects GEMINI.md and classifies it as a rule', () => {
    expect(geminiCliAdapter.detect(['.gemini/GEMINI.md'])).toBeGreaterThan(0.5)
    expect(geminiCliAdapter.classify('.gemini/GEMINI.md', '# rules')).toMatchObject({ kind: 'rule', target: 'workspace.agents', reasonCode: 'rules-file' })
    expect(geminiCliAdapter.classify('GEMINI.md', '# rules')).toMatchObject({ kind: 'rule', reasonCode: 'rules-file' })
  })
  it('flags Antigravity binary state as noise, and imports the notes beside it', () => {
    const hint = geminiCliAdapter.classify('.gemini/antigravity/implicit/x.pb', '')
    expect(hint?.kind).toBe('noise')
    expect(hint?.reasonCode).toBe('app-state')
    // Text under the same folder is text: only the IDE's own blobs are state.
    expect(geminiCliAdapter.classify('.gemini/antigravity/notes.md', '# note'))
      .toMatchObject({ kind: 'memory', selectedByDefault: true })
  })
  it('leaves non-gemini paths to the next adapter', () => {
    expect(geminiCliAdapter.classify('notes/a.md', 'x')).toBeNull()
    expect(geminiCliAdapter.classify('.claude/CLAUDE.md', '# rules')).toBeNull()
    expect(geminiCliAdapter.classify('src/app.ts', 'x')).toBeNull()
    expect(geminiCliAdapter.detect(['notes/a.md'])).toBe(0)
    expect(geminiCliAdapter.detect(['.claude/CLAUDE.md'])).toBe(0)
    expect(geminiCliAdapter.detect(['src/app.ts'])).toBe(0)
  })
})

describe('windsurf adapter', () => {
  it('maps global_rules, memories and workflows', () => {
    expect(windsurfAdapter.classify('.codeium/memories/global_rules.md', '# r'))
      .toMatchObject({ kind: 'rule', target: 'workspace.agents', reasonCode: 'rules-file' })
    expect(windsurfAdapter.classify('.codeium/windsurf/memories/fact.md', 'fact'))
      .toMatchObject({ kind: 'memory', target: 'vault.semantic', reasonCode: 'memory-note' })
    expect(windsurfAdapter.classify('.codeium/windsurf/workflows/pr.md', '# wf'))
      .toMatchObject({ kind: 'skill', target: 'skill', reasonCode: 'skill' })
    expect(windsurfAdapter.classify('.windsurf/rules/a.md', '# r')).toMatchObject({ kind: 'rule', reasonCode: 'rules-file' })
  })
  it('lists Codeium/Windsurf configuration as importable text, and only blobs as noise', () => {
    expect(windsurfAdapter.classify('.codeium/windsurf/state.json', '{}'))
      .toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
    expect(windsurfAdapter.classify('.codeium/windsurf/notes/x.txt', 'note text'))
      .toMatchObject({ kind: 'memory', selectedByDefault: true })
    expect(windsurfAdapter.classify('.codeium/windsurf/state.bin', '')?.kind).toBe('noise')
  })
  it('does not treat a directory merely named like .codeium/.windsurf as owned', () => {
    expect(windsurfAdapter.classify('xyz.codeium/memories/global_rules.md', '# r')).toBeNull()
    expect(windsurfAdapter.detect(['xyz.codeium/x.md'])).toBe(0)
    expect(windsurfAdapter.classify('xyz.windsurf/rules/a.md', '# r')).toBeNull()
    expect(windsurfAdapter.detect(['xyz.windsurf/x.md'])).toBe(0)
  })
  it('leaves non-windsurf paths to the next adapter', () => {
    expect(windsurfAdapter.classify('notes/a.md', 'x')).toBeNull()
    expect(windsurfAdapter.classify('.claude/CLAUDE.md', '# rules')).toBeNull()
    expect(windsurfAdapter.classify('src/app.ts', 'x')).toBeNull()
    expect(windsurfAdapter.detect(['notes/a.md'])).toBe(0)
    expect(windsurfAdapter.detect(['.claude/CLAUDE.md'])).toBe(0)
    expect(windsurfAdapter.detect(['src/app.ts'])).toBe(0)
  })
})

describe('copilot adapter (documented shape)', () => {
  it('maps instructions and agents', () => {
    expect(copilotAdapter.classify('.github/copilot-instructions.md', '# r'))
      .toMatchObject({ kind: 'rule', target: 'workspace.agents', reasonCode: 'rules-file' })
    const scoped = copilotAdapter.classify('.github/instructions/py.instructions.md', '---\napplyTo: "**/*.py"\n---\n# r')
    expect(scoped?.reason).toMatch(/applyTo/)
    expect(scoped).toMatchObject({ kind: 'rule', reasonCode: 'rules-file', scope: '**/*.py' })
    expect(copilotAdapter.classify('.github/agents/reviewer.agent.md', '---\nname: r\n---\nbody'))
      .toMatchObject({ kind: 'persona', target: 'agent', reasonCode: 'persona' })
    expect(copilotAdapter.rootHints.join(' ')).toMatch(/unverified/i)
  })
  it('does not treat a directory merely named like .github as owned', () => {
    expect(copilotAdapter.classify('xyz.github/copilot-instructions.md', '# r')).toBeNull()
    expect(copilotAdapter.detect(['xyz.github/copilot-instructions.md'])).toBe(0)
  })
  it('leaves non-copilot paths to the next adapter', () => {
    expect(copilotAdapter.classify('notes/a.md', 'x')).toBeNull()
    expect(copilotAdapter.classify('.claude/CLAUDE.md', '# rules')).toBeNull()
    expect(copilotAdapter.classify('src/app.ts', 'x')).toBeNull()
    expect(copilotAdapter.detect(['notes/a.md'])).toBe(0)
    expect(copilotAdapter.detect(['.claude/CLAUDE.md'])).toBe(0)
    expect(copilotAdapter.detect(['src/app.ts'])).toBe(0)
  })
})
