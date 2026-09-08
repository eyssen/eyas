// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  detectProfile,
  classifyFile,
  listProfiles,
  adapterFor,
} from '@modules/data-port/adapters/registry'
import { chatExportAdapter } from '@modules/data-port/adapters/chat-export'

const FM_NOTE = '---\nname: x\ndescription: d\ntype: feedback\n---\n- a\n- b\n- c\n- d\n- e\n'

describe('adapter registry', () => {
  it('lists every profile except auto, generic last', () => {
    const p = listProfiles()
    expect(p[0]).toBe('claude-code')
    expect(p[p.length - 1]).toBe('generic-md')
    expect(p).not.toContain('auto')
  })

  it('detects claude-code, grok-cli, obsidian and eyas-export from paths', () => {
    expect(detectProfile(['.claude/CLAUDE.md', 'x.md'])).toBe('claude-code')
    expect(detectProfile(['.grok/AGENTS.md', '.grok/memory/a.md'])).toBe('grok-cli')
    expect(detectProfile(['notes/a.md', '.obsidian/app.json'])).toBe('obsidian')
    expect(detectProfile(['manifest.json', 'vault/semantic/a.md'])).toBe('eyas-export')
    expect(detectProfile(['readme.md'])).toBe('generic-md')
  })

  it('never drops a bullet-heavy note as an index', () => {
    const { hint } = classifyFile('ai-memory/feedback_alpha_rule.md', FM_NOTE, 'claude-code')
    expect(hint.kind).toBe('memory')
    expect(hint.target).toBe('vault.semantic')
    expect(hint.selectedByDefault).toBe(true)
  })

  it('classifies MEMORY.md as an index unit, importable as one note', () => {
    const { hint } = classifyFile(
      '.grok/memory/MEMORY.md',
      '# Memory Index\n- [a](a.md)\n- [b](b.md)\n- [c](c.md)\n- [d](d.md)\n',
      'grok-cli',
    )
    expect(hint).toMatchObject({ kind: 'index', target: 'vault.semantic', selectedByDefault: true })
  })

  it('routes session notes to episodic, ticked, and Grok project summaries too', () => {
    const vaultSession = classifyFile(
      'Documents/Vault/notes/claude-sessions/2026-09/x.md',
      '---\ntype: grok-session\n---\nlog',
      'obsidian',
    )
    expect(vaultSession.hint).toMatchObject({
      kind: 'session',
      target: 'episodic',
      reasonCode: 'session-summary',
      selectedByDefault: true,
    })
    const grokSummary = classifyFile(
      '.grok/memory/proj-1234abcd/sessions/2026-09-05-x-01a0abcd.md',
      '## Session Summary\n\n- **Messages:** 1 user',
      'grok-cli',
    )
    expect(grokSummary.hint).toMatchObject({ kind: 'session', target: 'episodic', selectedByDefault: true })
  })

  it('routes .claude/agents personas to the agent target', () => {
    const { hint } = classifyFile(
      '.claude/agents/developer.md',
      '---\nname: developer\ndescription: Senior dev\ntools:\n  - Read\n---\nYou are…',
      'claude-code',
    )
    expect(hint).toMatchObject({ kind: 'persona', target: 'agent', selectedByDefault: true })
  })

  it('keeps skills and rules from the base heuristics', () => {
    expect(
      classifyFile('.claude/skills/alpha-ticket/SKILL.md', '---\nname: alpha-ticket\n---\n# T', 'claude-code').hint.kind,
    ).toBe('skill')
    expect(classifyFile('.claude/CLAUDE.md', '# rules', 'claude-code').hint).toMatchObject({
      kind: 'rule',
      target: 'workspace.agents',
    })
  })

  it('flags Grok index.sqlite as noise with a reason, not silently', () => {
    const { hint } = classifyFile('.grok/memory/proj-1/index.sqlite', '', 'grok-cli')
    expect(hint.kind).toBe('noise')
    expect(hint.reason).toMatch(/derived/i)
    expect(hint.reasonCode).toBe('derived-index')
  })

  it('adapterFor falls back to generic for unknown ids', () => {
    expect(adapterFor('generic-md').id).toBe('generic-md')
    expect(adapterFor('auto').id).toBe('generic-md')
  })

  it('names the adapter that claimed the file', () => {
    expect(classifyFile('.claude/CLAUDE.md', '# rules', 'claude-code').adapterId).toBe('claude-code')
    expect(classifyFile('.grok/memory/proj-1/index.sqlite', '', 'claude-code').adapterId).toBe('grok-cli')
    // A chat export is claimed by its own adapter, whatever profile the owner picked.
    expect(chatExportAdapter.classify('conversations.json', '[{')).not.toBeNull()
    const chat = classifyFile('conversations.json', '[{', 'claude-code')
    expect(chat.adapterId).toBe('chat-export')
    expect(chat.hint.kind).toBe('session')
  })

  it('gives every hint a kebab-case reason code', () => {
    const paths: Array<[string, string]> = [
      ['.claude/CLAUDE.md', '# rules'],
      ['ai-memory/feedback_alpha_rule.md', FM_NOTE],
      ['docs/howto.md', '# How to build\nsteps'],
      ['.claude/agents/developer.md', '---\nname: developer\ndescription: d\n---\nYou are…'],
    ]
    for (const [rel, head] of paths) {
      const { hint } = classifyFile(rel, head, 'claude-code')
      expect(hint.reasonCode).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('imports Claude auto-memory notes and their index without frontmatter cues', () => {
    const note = classifyFile('.claude/projects/-alpha-bravo/memory/project_alpha.md', 'Plain body, no frontmatter.\n', 'claude-code')
    expect(note.hint).toMatchObject({ kind: 'memory', target: 'vault.semantic', reasonCode: 'memory-note', selectedByDefault: true })
    const index = classifyFile('.claude/projects/-alpha-bravo/memory/MEMORY.md', '# Memory Index\n- [a](a.md)\n', 'claude-code')
    expect(index.hint).toMatchObject({ kind: 'index', target: 'vault.semantic', reasonCode: 'memory-index' })
  })

  it('leaves plain project markdown to the generic adapter, which imports it as a note', () => {
    const { hint, adapterId } = classifyFile('docs/howto.md', '# How to deploy\nRun the build.\n', 'claude-code')
    expect(adapterId).toBe('generic-md')
    expect(hint).toMatchObject({ kind: 'memory', target: 'vault.procedural', selectedByDefault: true })
  })

  it('imports a third-party product doc and a legacy memory folder, each labelled', () => {
    const thirdParty = classifyFile('.grok/docs/user-guide/13-memory.md', '# Cross-Session Memory', 'grok-cli')
    expect(thirdParty.adapterId).toBe('grok-cli')
    expect(thirdParty.hint).toMatchObject({ kind: 'knowledge', selectedByDefault: false, tags: ['third-party'] })
    const legacy = classifyFile('.claude/projects/-alpha/memory.local-backup-2026-05-09/project_x.md', 'x', 'claude-code')
    expect(legacy.adapterId).toBe('claude-code')
    expect(legacy.hint).toMatchObject({ kind: 'memory', selectedByDefault: true, tags: ['legacy'] })
  })

  it('gives the specific adapters first refusal under auto, never generic', () => {
    const auto = classifyFile('.claude/projects/-alpha/memory/note.md', '---\ntype: user\n---\nme', 'auto')
    expect(auto.adapterId).toBe('claude-code')
    expect(auto.hint.kind).toBe('memory')
    expect(classifyFile('docs/howto.md', '# How to', 'auto').adapterId).toBe('generic-md')
  })

  it('treats an explicit obsidian pick as a claim on the whole tree', () => {
    const picked = classifyFile('notes/a.md', '# note\ntext long enough to select', 'obsidian')
    expect(picked.adapterId).toBe('obsidian')
    expect(picked.hint.kind).toBe('memory')
    const notPicked = classifyFile('notes/a.md', '# note\ntext long enough to select', 'claude-code')
    expect(notPicked.adapterId).toBe('generic-md')
    expect(notPicked.hint.kind).toBe('memory')
  })

  it('names a plain .db file derived state, not an unrecognised blob', () => {
    const { hint } = classifyFile('x/index.db', '', 'claude-code')
    expect(hint).toMatchObject({ kind: 'noise', reasonCode: 'derived-index' })
  })

  it('claims a bare transcript at depth 0 only when the profile is claude-code', () => {
    const bare = classifyFile('x.jsonl', '{"type":"user"}', 'claude-code')
    expect(bare.adapterId).toBe('claude-code')
    expect(bare.hint).toMatchObject({ kind: 'session', target: 'episodic', selectedByDefault: true })
    expect(classifyFile('data/x.jsonl', '{"type":"user"}', 'claude-code').adapterId).toBe('chat-export')
    expect(classifyFile('x.jsonl', '{"type":"user"}', 'chat-export').adapterId).toBe('chat-export')
  })

  it('lists tool output saved beside a session as the session artefact it is', () => {
    const { hint, adapterId } = classifyFile(
      '.claude/projects/-alpha/00000000-0000-4000-8000-00000000ab01/tool-results/t.txt',
      'command output',
      'claude-code',
    )
    expect(adapterId).toBe('claude-code')
    expect(hint).toMatchObject({
      kind: 'session',
      target: 'episodic',
      reasonCode: 'session-artifact',
      selectedByDefault: false,
    })
  })

  it('does not let the vault adapters answer for unrelated files', () => {
    expect(adapterFor('obsidian').classify('docs/howto.md', '# How to')).toBeNull()
    expect(adapterFor('obsidian').classify('notes/a.md', 'x', { inVault: true })).not.toBeNull()
    expect(adapterFor('eyas-export').classify('docs/howto.md', '# How to')).toBeNull()
    expect(adapterFor('eyas-export').classify('vault/semantic/a.md', 'x')).not.toBeNull()
  })
})

describe('grok-cli adapter read()', () => {
  const REL = '.grok/memory/proj-1234abcd/sessions/2026-09-05-plan-the-work-01a0abcd.md'
  const RAW = Buffer.from(
    '## Session Summary\n\n- **Date:** 2026-09-05 14:32 UTC\n- **Messages:** 4 user\n\nDiscussed the plan.\n',
    'utf-8',
  )

  it('lifts the session id, date, project tag and title out of the summary', () => {
    const note = adapterFor('grok-cli').read!(REL, RAW, null, { mtime: '2026-01-01T00:00:00.000Z' })
    expect(note.sessionId).toBe('01a0abcd')
    expect(note.sessionDate).toBe('2026-09-05T14:32:00.000Z')
    expect(note.tags).toContain('grok-project:proj-1234abcd')
    expect(note.title).toBe('plan the work')
    expect(note.body).toContain('Discussed the plan.')
  })

  it('falls back to the basename date when the summary has no Date line', () => {
    const note = adapterFor('grok-cli').read!(REL, Buffer.from('## Session Summary\n\nno date line\n', 'utf-8'), null)
    expect(note.sessionDate).toBe('2026-09-05T00:00:00.000Z')
  })

  it('falls back to the file mtime when neither the body nor the name has a date', () => {
    const rel = '.grok/memory/proj-1234abcd/sessions/plan-the-work-01a0abcd.md'
    const note = adapterFor('grok-cli').read!(rel, Buffer.from('no date\n', 'utf-8'), null, {
      mtime: '2026-02-03T04:05:06.000Z',
    })
    expect(note.sessionDate).toBe('2026-02-03T04:05:06.000Z')
  })

  it('enriches a mixed-case session path and an uppercase id', () => {
    const rel = '.grok/memory/proj-1234abcd/Sessions/2026-09-05-X-01A0ABCD.md'
    const note = adapterFor('grok-cli').read!(rel, Buffer.from('## Session Summary\n\nbody\n', 'utf-8'), null)
    expect(note.sessionId).toBe('01A0ABCD')
    expect(note.sessionDate).toBe('2026-09-05T00:00:00.000Z')
    expect(note.tags).toContain('grok-project:proj-1234abcd')
    expect(note.title).toBe('X')
  })

  it('reads a non-session Grok file as a plain source note', () => {
    const note = adapterFor('grok-cli').read!('.grok/memory/alpha.md', Buffer.from(FM_NOTE, 'utf-8'), null)
    expect(note.sessionId).toBeNull()
    expect(note.tags).not.toContain('grok-project:proj-1234abcd')
  })
})

describe('a key inside an assistant file is a flag, not a refusal', () => {
  // R11.4: the importer stores what it finds. A memory note, command, skill or
  // rules file that happens to hold a key keeps its own kind and stays ticked;
  // the row is tagged `contains-secrets`, and recall — not the import — is what
  // hides it (D-7). Nothing is refused for holding a credential any more.
  const KEY = 'API_KEY=sk-alphaalphaalphaalphaalphaalpha0001\n'
  const OWN_KIND: Array<[string, string]> = [
    ['.claude/projects/p1/memory/keys.md', 'memory'],
    ['.claude/memory/keys.md', 'memory'],
    ['.claude/commands/x.md', 'skill'],
    ['.claude/skills/deploy/SKILL.md', 'skill'],
    ['.codeium/windsurf/memories/x.md', 'memory'],
    ['.codeium/memories/global_rules.md', 'rule'],
    ['.codex/prompts/x.md', 'skill'],
    ['.codex/skills/x/SKILL.md', 'skill'],
    ['.cursor/rules/x.mdc', 'rule'],
    ['.windsurf/rules/x.md', 'rule'],
    ['GEMINI.md', 'rule'],
    ['.github/copilot-instructions.md', 'rule'],
    ['.github/instructions/x.instructions.md', 'rule'],
    ['ai-memory/keys.md', 'memory'],
  ]
  for (const [rel, kind] of OWN_KIND) {
    it(`keeps ${rel} a ${kind} row and tags the key`, () => {
      const { hint } = classifyFile(rel, KEY, 'auto')
      expect(hint.kind).toBe(kind)
      expect(hint.selectedByDefault).toBe(true)
      expect(hint.tags).toContain('contains-secrets')
      expect(hint.reasonCode).not.toBe('secrets')
    })
  }

  it('leaves the same paths untagged when they hold no secret', () => {
    const command = classifyFile('.claude/commands/x.md', '# Deploy\nRun the checklist.\n', 'claude-code').hint
    expect(command.kind).toBe('skill')
    expect(command.tags ?? []).not.toContain('contains-secrets')
    const note = classifyFile('.claude/projects/p1/memory/n.md', FM_NOTE, 'claude-code').hint
    expect(note.kind).toBe('memory')
    expect(note.tags ?? []).not.toContain('contains-secrets')
  })

  it('bundles a credential-shaped file with its skill package, flagged rather than dropped', () => {
    for (const rel of ['.claude/skills/deploy/id_rsa', '.claude/skills/deploy/server.pem', '.claude/skills/deploy/credentials.json']) {
      const { hint } = classifyFile(rel, '', 'claude-code')
      expect(hint.kind).not.toBe('noise')
      expect(hint.reasonCode).not.toBe('secrets')
      expect(hint.tags).toContain('contains-secrets')
    }
  })

  it('keeps the Codex credential file its own, unmistakable row', () => {
    const { hint } = classifyFile('.codex/auth.json', '{"tokens":{}}', 'codex')
    expect(hint).toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
    expect(hint.tags).toContain('contains-secrets')
  })
})

describe('adapter profile claims an unmarked tree', () => {
  // A tree copied out of `~/.claude` or `~/.grok` carries no marker segment at
  // all; the profile the owner picked is then the only thing that says whose
  // files these are (C1).
  it('claims a bare transcript and a command tree under claude-code', () => {
    expect(classifyFile('x.jsonl', '{}', 'claude-code').hint).toMatchObject({ kind: 'session', reasonCode: 'transcript' })
    expect(classifyFile('commands/deploy.md', '# Deploy', 'claude-code').hint).toMatchObject({ kind: 'skill', reasonCode: 'slash-command' })
    expect(classifyFile('projects/alpha/memory/n.md', FM_NOTE, 'claude-code').hint.kind).toBe('memory')
  })

  it('claims the memory tree under grok-cli', () => {
    expect(classifyFile('memory/alpha/feedback_x.md', FM_NOTE, 'grok-cli').hint).toMatchObject({ kind: 'memory' })
    expect(classifyFile('memory/alpha/sessions/2026-01-02-x-abcdef12.md', '## Session Summary', 'grok-cli').hint)
      .toMatchObject({ kind: 'session', reasonCode: 'session-summary' })
  })

  it('never relabels a path that already names another assistant tree', () => {
    const { adapterId } = classifyFile('.cursor/rules/x.mdc', '---\nglobs: src/**\n---\nrule', 'claude-code')
    expect(adapterId).toBe('cursor')
  })
})
