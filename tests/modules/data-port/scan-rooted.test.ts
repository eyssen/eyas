// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanDirectory } from '@modules/data-port/scanners/scan-path'
import { cursorAdapter } from '@modules/data-port/adapters/cursor'
import { grokCliAdapter } from '@modules/data-port/adapters/grok-cli'
import type { ScanCandidate, SourceProfile } from '@modules/data-port/types'

/**
 * A scan rooted at one of the paths the wizard itself recommends must classify
 * the tree exactly as a scan of its parent would: rooted there, the relative
 * paths carry no `.claude/`, `.grok/` or `ai-memory/` segment for the rules to
 * recognise, and every durable note would otherwise arrive as unselectable
 * `not-durable` noise (C1).
 */
let home: string

const write = (relPath: string, content: string): void => {
  const full = join(home, ...relPath.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

const NOTE = '---\nname: feedback_alpha\ndescription: how the owner works\ntype: feedback\n---\nPrefer short answers.\n'
const PERSONA = '---\nname: critic\ndescription: reviews plans\n---\nYou are a careful reviewer.\n'
const SKILL = '---\nname: deploy\ndescription: Use when "deploy alpha"\n---\n# Deploy\nRun scripts/deploy.sh\n'
const SESSION = '## Session Summary\n\n- **Date:** 2026-01-02 10:00 UTC\n- **Messages:** 4 user\n'

beforeAll(() => {
  home = join(tmpdir(), `eyas-rooted-${process.pid}-${Math.random().toString(36).slice(2)}`)
  // Claude Code
  write('.claude/projects/alpha/memory/feedback_alpha.md', NOTE)
  write('.claude/projects/alpha/memory/MEMORY.md', '# Memory Index\n- [hook](feedback_alpha.md)\n')
  write('.claude/agents/critic.md', PERSONA)
  write('.claude/commands/deploy.md', '# Deploy\nRun the deploy checklist.\n')
  write('.claude/skills/deploy/SKILL.md', SKILL)
  write('.claude/skills/deploy/scripts/deploy.sh', '#!/bin/sh\necho deploying\n')
  // Grok CLI
  write('.grok/memory/alpha/feedback_bravo.md', NOTE)
  write('.grok/memory/alpha/MEMORY.md', '# Memory\n- [hook](feedback_bravo.md)\n')
  write('.grok/memory/alpha/sessions/2026-01-02-fix-thing-abcdef12.md', SESSION)
  // Codex
  write('.codex/AGENTS.md', '# Codex instructions\nAlways write tests.\n')
  write('.codex/prompts/review.md', '# Review\nCheck the diff.\n')
  write(
    '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-abc.jsonl',
    `${JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: 'hello' } })}\n`,
  )
  // Cursor
  write('.cursor/rules/alpha.mdc', '---\nglobs: src/**/*.ts\n---\nUse strict mode.\n')
  write(
    '.cursor/agent-transcripts/abc.jsonl',
    `${JSON.stringify({ role: 'user', content: 'hello' })}\n${JSON.stringify({ role: 'assistant', content: 'hi there' })}\n`,
  )
  // Gemini CLI
  write('.gemini/GEMINI.md', '# Gemini context\nAlways answer briefly.\n')
  // Windsurf / Codeium
  write('.codeium/windsurf/memories/alpha.md', '# Alpha memory\nThe owner prefers tea.\n')
  write('.codeium/memories/global_rules.md', '# Global rules\nAlways write tests.\n')
  write('.windsurf/rules/alpha.md', '# Alpha rules\nAlways write tests.\n')
  // Copilot
  write('.github/instructions/alpha.instructions.md', '---\napplyTo: "**/*.ts"\n---\nUse strict mode.\n')
  write('.github/agents/critic.agent.md', PERSONA)
  // Obsidian vault
  write('Documents/Vault/.obsidian/app.json', '{"theme":"dark"}')
  write('Documents/Vault/ai-memory/feedback_alpha.md', NOTE)
  // Plain markdown folder
  write('notes/declared.md', NOTE)
  write('notes/plain.md', '# Plain note\nA long enough note about how the owner likes to work, kept for later.\n')
})
afterAll(() => rmSync(home, { recursive: true, force: true }))

const scan = async (rootRel: string, profile: SourceProfile): Promise<ScanCandidate[]> => {
  const rows = (await scanDirectory({ rootPath: join(home, ...rootRel.split('/')), sourceProfile: profile }))
    .candidates
  // R11.3: no text row is ever unimportable — `target: 'none'` belongs to noise alone.
  expect(rows.filter((c) => c.target === 'none' && c.kind !== 'noise')).toEqual([])
  return rows
}

const row = (rows: ScanCandidate[], relPath: string): ScanCandidate => {
  const hit = rows.find((c) => c.relativePath === relPath)
  expect(hit, `no row for ${relPath} in [${rows.map((c) => c.relativePath).join(', ')}]`).toBeTruthy()
  return hit!
}

describe('scanDirectory rooted at an advertised root hint', () => {
  const cases: Array<{ hint: string; root: string; profile: SourceProfile; path: string; expect: Partial<ScanCandidate> }> = [
    // claude-code
    { hint: '~/.claude', root: '.claude', profile: 'claude-code', path: 'projects/alpha/memory/feedback_alpha.md', expect: { kind: 'memory', target: 'vault.semantic', selectedByDefault: true } },
    { hint: '~/.claude (personas)', root: '.claude', profile: 'claude-code', path: 'agents/critic.md', expect: { kind: 'persona', target: 'agent', reasonCode: 'persona' } },
    { hint: '~/.claude (commands)', root: '.claude', profile: 'claude-code', path: 'commands/deploy.md', expect: { kind: 'skill', target: 'skill', reasonCode: 'slash-command' } },
    { hint: '~/.claude (auto)', root: '.claude', profile: 'auto', path: 'projects/alpha/memory/feedback_alpha.md', expect: { kind: 'memory', target: 'vault.semantic' } },
    { hint: '~/.claude/projects/<project>/memory', root: '.claude/projects/alpha/memory', profile: 'claude-code', path: 'feedback_alpha.md', expect: { kind: 'memory', target: 'vault.semantic', reasonCode: 'memory-note' } },
    { hint: '~/.claude/projects/<project>/memory (index)', root: '.claude/projects/alpha/memory', profile: 'claude-code', path: 'MEMORY.md', expect: { kind: 'index', target: 'vault.semantic', reasonCode: 'memory-index' } },
    { hint: '~/.claude/skills', root: '.claude/skills', profile: 'claude-code', path: 'deploy/SKILL.md', expect: { kind: 'skill', target: 'skill' } },
    { hint: '~/.claude/agents', root: '.claude/agents', profile: 'claude-code', path: 'critic.md', expect: { kind: 'persona', target: 'agent' } },
    // grok-cli
    { hint: '~/.grok', root: '.grok', profile: 'grok-cli', path: 'memory/alpha/feedback_bravo.md', expect: { kind: 'memory', target: 'vault.semantic', selectedByDefault: true } },
    { hint: '~/.grok (session summary)', root: '.grok', profile: 'grok-cli', path: 'memory/alpha/sessions/2026-01-02-fix-thing-abcdef12.md', expect: { kind: 'session', target: 'episodic', reasonCode: 'session-summary', selectedByDefault: true } },
    { hint: '~/.grok/memory', root: '.grok/memory', profile: 'grok-cli', path: 'alpha/feedback_bravo.md', expect: { kind: 'memory', target: 'vault.semantic' } },
    { hint: '~/.grok/memory (index)', root: '.grok/memory', profile: 'grok-cli', path: 'alpha/MEMORY.md', expect: { kind: 'index', reasonCode: 'memory-index' } },
    { hint: '~/.grok/memory/<project>/sessions', root: '.grok/memory/alpha/sessions', profile: 'grok-cli', path: '2026-01-02-fix-thing-abcdef12.md', expect: { kind: 'session', target: 'episodic', reasonCode: 'session-summary' } },
    // codex
    { hint: '~/.codex', root: '.codex', profile: 'codex', path: 'AGENTS.md', expect: { kind: 'rule', target: 'workspace.agents' } },
    { hint: '~/.codex (prompts)', root: '.codex', profile: 'codex', path: 'prompts/review.md', expect: { kind: 'skill', target: 'skill', reasonCode: 'slash-command' } },
    { hint: '~/.codex/sessions', root: '.codex/sessions', profile: 'codex', path: '2026/01/02/rollout-2026-01-02T10-00-00-abc.jsonl', expect: { kind: 'session', target: 'episodic', reasonCode: 'transcript' } },
    // cursor
    { hint: '~/.cursor', root: '.cursor', profile: 'cursor', path: 'rules/alpha.mdc', expect: { kind: 'rule', target: 'workspace.agents', reasonCode: 'cursor-rule' } },
    { hint: '<repo>/.cursor/rules', root: '.cursor/rules', profile: 'cursor', path: 'alpha.mdc', expect: { kind: 'rule', reasonCode: 'cursor-rule', scope: 'src/**/*.ts' } },
    // gemini-cli
    { hint: '~/.gemini', root: '.gemini', profile: 'gemini-cli', path: 'GEMINI.md', expect: { kind: 'rule', target: 'workspace.agents', reasonCode: 'rules-file' } },
    // windsurf
    { hint: '~/.codeium/windsurf', root: '.codeium/windsurf', profile: 'windsurf', path: 'memories/alpha.md', expect: { kind: 'memory', target: 'vault.semantic' } },
    { hint: '~/.codeium/memories', root: '.codeium/memories', profile: 'windsurf', path: 'global_rules.md', expect: { kind: 'rule', target: 'workspace.agents' } },
    { hint: '<repo>/.windsurf/rules', root: '.windsurf/rules', profile: 'windsurf', path: 'alpha.md', expect: { kind: 'rule', target: 'workspace.agents' } },
    // copilot
    { hint: '<repo>/.github/instructions', root: '.github/instructions', profile: 'copilot', path: 'alpha.instructions.md', expect: { kind: 'rule', target: 'workspace.agents', scope: '**/*.ts' } },
    { hint: '<repo>/.github/agents', root: '.github/agents', profile: 'copilot', path: 'critic.agent.md', expect: { kind: 'persona', target: 'agent' } },
    // obsidian
    { hint: '~/Documents/<Vault>', root: 'Documents/Vault', profile: 'obsidian', path: 'ai-memory/feedback_alpha.md', expect: { kind: 'memory', target: 'vault.semantic' } },
    { hint: '~/Documents/<Vault>/ai-memory', root: 'Documents/Vault/ai-memory', profile: 'obsidian', path: 'feedback_alpha.md', expect: { kind: 'memory', target: 'vault.semantic' } },
    { hint: '~/Documents/<Vault>/ai-memory (auto)', root: 'Documents/Vault/ai-memory', profile: 'auto', path: 'feedback_alpha.md', expect: { kind: 'memory', target: 'vault.semantic' } },
    // generic markdown folder
    { hint: '~/notes (declared kind)', root: 'notes', profile: 'generic-md', path: 'declared.md', expect: { kind: 'memory', target: 'vault.semantic', selectedByDefault: true } },
    { hint: '~/notes (plain)', root: 'notes', profile: 'generic-md', path: 'plain.md', expect: { kind: 'memory', target: 'vault.semantic' } },
  ]

  for (const c of cases) {
    it(`classifies ${c.path} under ${c.hint}`, async () => {
      expect(row(await scan(c.root, c.profile), c.path)).toMatchObject(c.expect)
    })
  }
})

describe('scanDirectory rooted inside an assistant tree', () => {
  it('classifies a Grok tree the same way rooted at it as from its parent', async () => {
    const parent = await scan('.grok/memory', 'grok-cli')
    const rooted = await scan('.grok/memory/alpha', 'grok-cli')
    for (const name of ['feedback_bravo.md', 'MEMORY.md']) {
      const a = row(parent, `alpha/${name}`)
      const b = row(rooted, name)
      expect({ kind: b.kind, target: b.target, reasonCode: b.reasonCode, selectedByDefault: b.selectedByDefault })
        .toEqual({ kind: a.kind, target: a.target, reasonCode: a.reasonCode, selectedByDefault: a.selectedByDefault })
    }
  })

  it('leaves nothing durable as not-durable noise under a rooted Claude scan', async () => {
    const rows = await scan('.claude', 'claude-code')
    const durable = rows.filter((c) => c.reasonCode === 'not-durable')
    expect(durable.map((c) => c.relativePath)).toEqual([])
  })

  it('keeps a folder that names no assistant tree classified by its own paths', async () => {
    // No marker segment in the root, so a file at its top stays a root-level
    // file: `CLAUDE.md` there is the workspace rules file it looks like.
    write('plainrepo/CLAUDE.md', '# Rules\nAlways write tests.\n')
    expect(row(await scan('plainrepo', 'auto'), 'CLAUDE.md')).toMatchObject({ kind: 'rule', target: 'workspace.agents' })
  })
})

/**
 * The row is classified at scan time and read again at apply time. A rooted
 * scan hands the classifier a path the row itself does not have, so unless that
 * path travels ON the row the two calls disagree: the adapter that claimed the
 * file cannot recognise the path it is handed a second time, and the unit is
 * lost (`missing-unit`) or the note arrives stripped of everything its path
 * carried. `classifiedPath` is what closes that gap (IMP-1, IMP-2).
 */
describe('classifiedPath survives a rooted scan', () => {
  it('lets the Cursor adapter expand a transcript rooted at .cursor and at agent-transcripts', async () => {
    for (const [root, relPath] of [
      ['.cursor', 'agent-transcripts/abc.jsonl'],
      ['.cursor/agent-transcripts', 'abc.jsonl'],
    ] as const) {
      const unit = row(await scan(root, 'cursor'), relPath)
      expect(unit, `${root} → ${relPath}`).toMatchObject({ kind: 'session', target: 'episodic', adapterId: 'cursor' })
      expect(unit.unit).toBeTruthy()
      expect(unit.classifiedPath).toBe('.cursor/agent-transcripts/abc.jsonl')

      // What the runner does with it: the claiming adapter, handed the path the
      // row carries, still renders the transcript. Handed the row's own path it
      // would render nothing and the session would be dropped.
      const raw = readFileSync(join(home, '.cursor', 'agent-transcripts', 'abc.jsonl'))
      const rendered = cursorAdapter.expand!(unit.classifiedPath ?? unit.relativePath, raw)
      expect(rendered).toHaveLength(1)
      expect(rendered[0].content).toContain('hello')
      expect(rendered[0].content).toContain('hi there')
    }
  })

  it('lets the Grok adapter enrich a session summary rooted at memory and at sessions', async () => {
    const file = '2026-01-02-fix-thing-abcdef12.md'
    for (const [root, relPath] of [
      ['.grok/memory', `alpha/sessions/${file}`],
      ['.grok/memory/alpha/sessions', file],
    ] as const) {
      const candidate = row(await scan(root, 'grok-cli'), relPath)
      expect(candidate, `${root} → ${relPath}`).toMatchObject({ kind: 'session', target: 'episodic', adapterId: 'grok-cli' })
      expect(candidate.classifiedPath).toBe(`.grok/memory/alpha/sessions/${file}`)

      // Rooted at the sessions directory the project name is not in the row's
      // own path at all — only the classified path can still recover it.
      const note = grokCliAdapter.read!(
        candidate.classifiedPath ?? candidate.relativePath,
        Buffer.from(SESSION, 'utf-8'),
        null,
        {},
      )
      expect(note.tags).toContain('grok-project:alpha')
      expect(note.sessionId).toBe('abcdef12')
      expect(note.sessionDate).toBe('2026-01-02T10:00:00.000Z')
      expect(note.title).toBe('fix thing')
    }
  })

  it('leaves classifiedPath off a scan whose root names no assistant tree', async () => {
    expect(row(await scan('notes', 'generic-md'), 'plain.md').classifiedPath).toBeUndefined()
  })
})
