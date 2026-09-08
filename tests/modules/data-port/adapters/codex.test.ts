// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { codexAdapter } from '@modules/data-port/adapters/codex'
import { classifyPath } from '@modules/data-port/scanners/heuristics'

/** The slice of `bun:sqlite`'s Database these cases use. */
interface TestDatabase {
  run(sql: string): void
  prepare(sql: string): { all(): unknown[]; get(): unknown }
  close(): void
}
type TestDatabaseCtor = new (path: string, opts?: { readonly?: boolean }) => TestDatabase

/**
 * `bun:sqlite` is a Bun built-in, and the project supports Node as a fallback
 * runtime — so this file must not die at import time when the suite runs under
 * Node. Loading it here the same way the adapter does splits the file in two:
 * the cases that need a real database run under Bun, and the adapter's
 * `needs-bun` degradation path is exercised exactly where it happens (A13).
 */
const bunSqlite = ((): TestDatabaseCtor | null => {
  try {
    return (createRequire(import.meta.url)('bun:sqlite') as { Database: TestDatabaseCtor }).Database
  } catch {
    return null
  }
})()
const hasBunSqlite = bunSqlite !== null

/** Only reached from cases gated on `hasBunSqlite`. */
const openDatabase = (path: string, opts?: { readonly?: boolean }): TestDatabase => {
  if (!bunSqlite) throw new Error('bun:sqlite is unavailable — this case should have been skipped')
  return new bunSqlite(path, opts)
}

const root = join(tmpdir(), `eyas-codex-${process.pid}`)
const dbPath = join(root, '.codex', 'memories_1.sqlite')
const rolloutPath = join(root, '.codex', 'sessions', '2026', '01', '02', 'rollout-2026-01-02T10-00-00-abc.jsonl')

const SCHEMA = `CREATE TABLE stage1_outputs (thread_id TEXT PRIMARY KEY, source_updated_at INTEGER NOT NULL, raw_memory TEXT NOT NULL, rollout_summary TEXT NOT NULL, rollout_slug TEXT, generated_at INTEGER NOT NULL)`

beforeAll(() => {
  mkdirSync(join(root, '.codex', 'sessions', '2026', '01', '02'), { recursive: true })
  if (hasBunSqlite) {
    const db = openDatabase(dbPath)
    db.run(SCHEMA)
    db.run(`INSERT INTO stage1_outputs VALUES ('t1', 1767340800000, 'Owner prefers bun over npm.', 'Set up a bun project.', 'bun-setup', 1767340800000)`)
    db.close()
  }
  writeFileSync(rolloutPath, [
    JSON.stringify({ timestamp: '2026-01-02T10:00:00.000Z', type: 'session_meta', payload: { id: 'abc', cwd: '/w', originator: 'codex_cli' } }),
    JSON.stringify({ timestamp: '2026-01-02T10:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } }),
    JSON.stringify({ timestamp: '2026-01-02T10:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi there' }] } }),
  ].join('\n'))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('codex adapter', () => {
  it('detects a .codex tree', () => {
    expect(codexAdapter.detect(['.codex/config.toml'])).toBeGreaterThan(0.5)
  })

  it('detects a scan rooted inside .codex, where the marker directory is gone', () => {
    expect(codexAdapter.detect(['config.toml', 'memories_1.sqlite'])).toBeGreaterThan(0.5)
  })

  // The adapter reads Codex's memory database through `bun:sqlite`. On a
  // runtime that has no such module the database must degrade to a visible,
  // unselectable row saying why — never a crash and never a silent drop. This
  // is the branch that runs on Node; the cases below are its Bun counterpart.
  it.runIf(!hasBunSqlite)('says a memory database needs Bun instead of failing', () => {
    const units = codexAdapter.expand!('.codex/memories_1.sqlite', Buffer.from('sqlite bytes'))
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({
      unit: 'unavailable',
      title: 'memories_1.sqlite',
      content: '',
      hint: { kind: 'noise', target: 'none', reasonCode: 'needs-bun', selectedByDefault: false },
    })
    expect(units[0].hint.reason).toMatch(/needs Bun/)
  })

  it.skipIf(!hasBunSqlite)('expands a memories sqlite into one unit per row with verbatim raw_memory', () => {
    const units = codexAdapter.expand!('.codex/memories_1.sqlite', readFileSync(dbPath))
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ unit: 't1', title: 'bun-setup', hint: { kind: 'memory', target: 'vault.semantic', reasonCode: 'memory-note' } })
    expect(units[0].content).toContain('Owner prefers bun over npm.')
    expect(units[0].content).toContain('Set up a bun project.')
  })

  // A5.2 — the job runner builds the SourceNote from the unit (G5), so the
  // structured fields and the dates have to travel ON the unit.
  it.skipIf(!hasBunSqlite)('carries the row fields and the source_updated_at day on the unit itself', () => {
    const [unit] = codexAdapter.expand!('.codex/memories_1.sqlite', readFileSync(dbPath))
    expect(unit.data).toEqual({ thread_id: 't1', rollout_slug: 'bun-setup', source_updated_at: 1767340800000 })
    expect(unit.created).toBe('2026-01-02')
    expect(unit.updated).toBe('2026-01-02')
    expect(unit.bytes).toBe(Buffer.byteLength(unit.content))
  })

  // A5.1 — a live Codex database keeps its newest rows in a `-wal` sidecar.
  // The writer handle stays OPEN for the whole case on purpose: closing it
  // checkpoints the WAL into the main file, which would make the test vacuous.
  it.skipIf(!hasBunSqlite)('reads rows that still live in a -wal sidecar when given the source path', () => {
    const walPath = join(root, '.codex', 'memories_9.sqlite')
    const db = openDatabase(walPath)
    db.run('PRAGMA journal_mode = WAL')
    db.run(SCHEMA)
    db.run(`INSERT INTO stage1_outputs VALUES ('t9', 1767340800000, 'Uncheckpointed row.', 'Still in the WAL.', 'wal-row', 1767340800000)`)
    try {
      const raw = readFileSync(walPath)
      const units = codexAdapter.expand!('.codex/memories_9.sqlite', raw, walPath)
      expect(units.map((u) => u.unit)).toEqual(['t9'])
      expect(units[0].content).toContain('Uncheckpointed row.')

      // The main file alone does not carry the row — the buffer is not enough.
      const blind = codexAdapter.expand!('.codex/memories_9.sqlite', raw)
      expect(blind.some((u) => u.content.includes('Uncheckpointed row.'))).toBe(false)
    } finally {
      db.close()
    }
  })

  // A WAL database says so in its header, and SQLite refuses to open one
  // read-only without the `-shm` companion — so a checkpointed database whose
  // sidecars were cleaned up must still come back through the copy fallback.
  it.skipIf(!hasBunSqlite)('still reads a WAL database whose -wal and -shm sidecars are gone', () => {
    const path = join(root, '.codex', 'memories_8.sqlite')
    const db = openDatabase(path)
    db.run('PRAGMA journal_mode = WAL')
    db.run(SCHEMA)
    db.run(`INSERT INTO stage1_outputs VALUES ('t8', 1767340800000, 'Checkpointed row.', '', 'cold-row', 1767340800000)`)
    db.close()
    for (const sidecar of ['-wal', '-shm']) {
      if (existsSync(path + sidecar)) unlinkSync(path + sidecar)
    }
    // bun:sqlite opens lazily, so the refusal surfaces on the first query.
    expect(() => openDatabase(path, { readonly: true }).prepare('SELECT 1 FROM stage1_outputs').all()).toThrow()

    const units = codexAdapter.expand!('.codex/memories_8.sqlite', readFileSync(path), path)
    expect(units.map((u) => u.unit)).toEqual(['t8'])
    expect(units[0].content).toBe('Checkpointed row.')
  })

  it('renders a rollout jsonl as a reversible transcript', () => {
    const units = codexAdapter.expand!('.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-abc.jsonl', readFileSync(rolloutPath))
    expect(units).toHaveLength(1)
    expect(units[0].hint).toMatchObject({ kind: 'session', target: 'episodic', reasonCode: 'transcript', selectedByDefault: true })
    expect(units[0].content).toBe('**user:** hello\n\n**assistant:** hi there')
    expect(units[0].sessionId).toBe('abc')
    expect(units[0].sessionDate).toBe('2026-01-02T10:00:00.000Z')
  })

  it('falls back to the file name when a rollout has no session_meta line', () => {
    const rel = '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-def.jsonl'
    const raw = Buffer.from(
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'only turn' }] } }),
      'utf-8',
    )
    const [unit] = codexAdapter.expand!(rel, raw)
    expect(unit.sessionId).toBe('def')
    expect(unit.sessionDate).toBe('2026-01-02T10:00:00.000Z')
    expect(unit.content).toBe('**user:** only turn')
  })

  it('keeps an unparsable rollout line verbatim and says how many there were', () => {
    const rel = '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-ghi.jsonl'
    const raw = Buffer.from(['{ not json', JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: 'plain string' } })].join('\n'), 'utf-8')
    const [unit] = codexAdapter.expand!(rel, raw)
    expect(unit.content).toBe('**user:** plain string\n\n## Unparsed lines\n\n```text\n{ not json\n```')
    expect(unit.hint).toMatchObject({ kind: 'session', reasonCode: 'transcript' })
    expect(unit.hint.reason).toMatch(/1 line could not be parsed/)
    expect(unit.preview).toMatch(/1 line could not be parsed/)
  })

  it('keeps a truncated rollout line rather than dropping the turn it held', () => {
    const rel = '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-mno.jsonl'
    const turn = (text: string) =>
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: text === 'final' ? 'assistant' : 'user', content: text } })
    const truncated = turn('lost turn').slice(0, 40)
    const raw = Buffer.from([turn('hello'), truncated, turn('final')].join('\n'), 'utf-8')
    const [unit] = codexAdapter.expand!(rel, raw)
    expect(unit.content).toContain('**user:** hello')
    expect(unit.content).toContain('**assistant:** final')
    expect(unit.content).toContain(truncated)
    expect(unit.hint.reason).toMatch(/1 line could not be parsed/)
  })

  it('lists a rollout whose every line is unreadable as invalid JSON, keeping the lines', () => {
    const rel = '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-pqr.jsonl'
    const raw = Buffer.from(['{ not json', 'also { not json'].join('\n'), 'utf-8')
    const [unit] = codexAdapter.expand!(rel, raw)
    expect(unit.hint).toMatchObject({ kind: 'knowledge', target: 'vault.semantic', reasonCode: 'invalid-json', selectedByDefault: false })
    // The bytes ARE the row's content: an unreadable file is still the owner's.
    expect(unit.content).toBe(raw.toString('utf-8'))
    expect(unit.hint.reason).toMatch(/2 lines could not be parsed/)
  })

  it('keeps a rollout with no message turns as a visible, unselectable row', () => {
    const rel = '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-jkl.jsonl'
    const raw = Buffer.from(JSON.stringify({ type: 'turn_context', payload: { cwd: '/w' } }), 'utf-8')
    const [unit] = codexAdapter.expand!(rel, raw)
    expect(unit.hint).toMatchObject({ kind: 'noise', reasonCode: 'empty', selectedByDefault: false })
    expect(unit.sessionId).toBe('jkl')
    expect(unit.data).toMatchObject({ metaLines: 1, turns: 0 })
  })

  // R11 loses nothing: a rollout is more than its two message roles. Reasoning,
  // tool calls, their output and the CLI's own event echoes all reach the
  // transcript, each under a role that says what it is.
  it('renders reasoning, tool calls, tool output and event messages, not only messages', () => {
    const rel = '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-stu.jsonl'
    const raw = Buffer.from(
      [
        JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Plan the alpha step' }] } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"cmd":"ls"}' } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', output: 'alpha.txt' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'done' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'thanks' } }),
        JSON.stringify({ type: 'turn_context', payload: { cwd: '/w' } }),
      ].join('\n'),
      'utf-8',
    )
    const [unit] = codexAdapter.expand!(rel, raw)
    expect(unit.content).toContain('**reasoning:** Plan the alpha step')
    expect(unit.content).toContain('**tool:** ```json\n{"type":"function_call","name":"shell","arguments":"{\\"cmd\\":\\"ls\\"}"}\n```')
    expect(unit.content).toContain('**tool:** ```json\n{"type":"function_call_output","output":"alpha.txt"}\n```')
    expect(unit.content).toContain('**assistant:** done')
    expect(unit.content).toContain('**user:** thanks')
    expect(unit).toMatchObject({ turns: 5, data: { metaLines: 1 } })
    expect(unit.hint).toMatchObject({ kind: 'session', reasonCode: 'transcript', selectedByDefault: true })
  })

  it('escapes a turn that quotes a role marker, so the render reads back as it was written', () => {
    const rel = '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-vwx.jsonl'
    const raw = Buffer.from(
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: '**assistant:** not really' } }),
      'utf-8',
    )
    const [unit] = codexAdapter.expand!(rel, raw)
    expect(unit.content).toBe('**user:** \\**assistant:** not really')
  })

  it('counts a rollout without collecting it, and agrees with the collected render', () => {
    const rel = '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-yza.jsonl'
    const raw = readFileSync(rolloutPath)
    const [collected] = codexAdapter.expand!(rel, raw)
    const [counted] = codexAdapter.expand!(rel, raw, undefined, { withContent: false })
    expect(counted.content).toBe('')
    expect(counted.contentOmitted).toBe(true)
    expect(counted.unit).toBe(collected.unit)
    expect(counted.bytes).toBe(Buffer.byteLength(collected.content))
  })

  it('stores an oversized rollout as ordered parts whose concatenation is the whole render', () => {
    const rel = '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-bcd.jsonl'
    const raw = Buffer.from(
      Array.from({ length: 40 }, (_, i) =>
        JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: 'alpha '.repeat(20) + i } }),
      ).join('\n'),
      'utf-8',
    )
    const units = codexAdapter.expand!(rel, raw, undefined, { maxBodyBytes: 800 })
    expect(units.length).toBeGreaterThan(1)
    expect(units.map((u) => u.unit)).toEqual(units.map((_, i) => `rollout#${i + 1}`))
    const [whole] = codexAdapter.expand!(rel, raw)
    expect(units.map((u) => u.content).join('\n\n')).toBe(whole.content)
    expect(units.map((u) => u.unit)).toEqual(
      codexAdapter.expand!(rel, raw, undefined, { maxBodyBytes: 800, withContent: false }).map((u) => u.unit),
    )
  })

  // Every line that parsed must land in a turn, in `metaLines`, or in the kept
  // lines with its reason — never nowhere.
  it('accounts for every line of a rollout, keeping the shapes it cannot render', () => {
    const rel = '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-efg.jsonl'
    const lines = [
      JSON.stringify({ type: 'session_meta', payload: { id: 'efg' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [] } }),
      JSON.stringify({ note: 'the words the owner typed' }),
      JSON.stringify('a bare string line'),
      JSON.stringify({ type: 'turn_context', payload: { cwd: '/w' } }),
      '{ not json',
    ]
    const [unit] = codexAdapter.expand!(rel, Buffer.from(lines.join('\n'), 'utf-8'))
    // 1 turn + 3 meta (session_meta, the empty message, turn_context)
    // + 2 kept as written + 1 unparsable = every line.
    expect(unit.data).toMatchObject({ turns: 1, metaLines: 3, unrendered: 2, unparsed: 1 })
    expect((unit.data!.turns as number) + (unit.data!.metaLines as number) + (unit.data!.unrendered as number) + (unit.data!.unparsed as number)).toBe(lines.length)
    expect(unit.content).toContain('**user:** hello')
    expect(unit.content).toContain('the words the owner typed')
    expect(unit.content).toContain('a bare string line')
    expect(unit.content).toContain('{ not json')
    expect(unit.hint.reason).toMatch(/1 line could not be parsed; 2 lines kept as written/)
  })

  it('holds no line and renders no section for a rollout it is only counting', () => {
    const rel = '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-hij.jsonl'
    const raw = Buffer.from(
      Array.from({ length: 3000 }, (_, i) =>
        i % 3 === 0
          ? '{ broken line that was cut'
          : JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: `alpha ${i}` } }),
      ).join('\n'),
      'utf-8',
    )
    const [counted] = codexAdapter.expand!(rel, raw, undefined, { withContent: false })
    const [collected] = codexAdapter.expand!(rel, raw)
    expect(counted).toMatchObject({ unit: collected.unit, content: '', contentOmitted: true })
    expect(counted.bytes).toBe(Buffer.byteLength(collected.content))
    expect(counted.data).toMatchObject({ unparsed: 1000 })
    // A rollout no line of which parsed keeps its bytes only when asked.
    const broken = Buffer.from(Array.from({ length: 500 }, (_, i) => `{ broken ${i}`).join('\n'), 'utf-8')
    const [countedBroken] = codexAdapter.expand!(rel, broken, undefined, { withContent: false })
    const [wholeBroken] = codexAdapter.expand!(rel, broken)
    expect(countedBroken).toMatchObject({ content: '', contentOmitted: true, bytes: wholeBroken.bytes })
    expect(wholeBroken.content).toBe(broken.toString('utf-8'))
  })

  it('lists config, auth and the command history as importable, unticked config', () => {
    expect(codexAdapter.classify('.codex/config.toml', '')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
    expect(codexAdapter.classify('.codex/auth.json', '')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
    expect(codexAdapter.classify('.codex/history.jsonl', '')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
  })

  // The CLI's OAuth tokens. Stored verbatim like everything else (R11.4), but
  // never as a note the owner would tick by accident: its own row, unticked and
  // tagged, so recall can hide it (D-7).
  it('keeps auth.json a tagged, unticked row rather than a tickable export', () => {
    const AUTH = JSON.stringify({
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbHBoYSJ9.c2lnbmF0dXJl',
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6ImFsbCJ9.c2lnbmF0dXJl',
        refresh_token: 'rt-0000-1111-2222-3333',
        account_id: '00000000-0000-4000-8000-000000000000',
      },
      last_refresh: '2026-01-02T10:00:00.000Z',
    })
    // What the file would be worth without this adapter: a row the shared
    // heuristics would not call configuration.
    expect(classifyPath('auth.json', AUTH, 'codex').reasonCode).not.toBe('config')

    for (const rel of ['.codex/auth.json', 'auth.json']) {
      const hint = codexAdapter.classify(rel, AUTH, { profile: 'codex' })
      expect(hint).toMatchObject({
        kind: 'knowledge',
        target: 'vault.semantic',
        reasonCode: 'config',
        selectedByDefault: false,
        tags: ['contains-secrets'],
      })
    }
  })

  it('claims a memories database only inside a codex tree or under the codex profile', () => {
    expect(codexAdapter.classify('backups/memories_3.sqlite', '')).toBeNull()
    expect(codexAdapter.classify('.codex/memories_3.sqlite', '')).toMatchObject({ kind: 'memory', reasonCode: 'memory-note' })
    expect(codexAdapter.classify('memories_3.sqlite', '', { profile: 'codex' })).toMatchObject({ kind: 'memory', reasonCode: 'memory-note' })
    // Same gate for a strictly-named rollout that wandered out of the tree.
    expect(codexAdapter.classify('backups/rollout-2026-01-02T10-00-00-abc.jsonl', '')).toBeNull()
  })

  it('claims memories and rollouts, and answers for nothing outside a codex tree', () => {
    expect(codexAdapter.classify('.codex/memories_1.sqlite', '')).toMatchObject({ kind: 'memory', reasonCode: 'memory-note', selectedByDefault: true })
    expect(codexAdapter.classify('.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-abc.jsonl', '')).toMatchObject({ kind: 'session', selectedByDefault: true })
    expect(codexAdapter.classify('notes/alpha.md', '# alpha')).toBeNull()
    expect(codexAdapter.classify('.grok/memory/proj-1/index.sqlite', '')).toBeNull()
    // A deployment log that happens to start with "rollout-" is not a session.
    expect(codexAdapter.classify('ops/rollout-deploy.jsonl', '')).toBeNull()
    expect(codexAdapter.detect(['ops/rollout-deploy.jsonl'])).toBe(0)
  })

  it('names the Codex rules file and custom prompts, which the shared heuristics cannot', () => {
    // The shared classifier knows the .claude/.cursor/.grok trees, not .codex,
    // so a custom prompt would reach the vault as an ordinary note instead of
    // becoming a skill. The adapter is what gets it right.
    expect(classifyPath('.codex/prompts/plan.md', '# plan', 'codex').kind).not.toBe('skill')
    expect(codexAdapter.classify('.codex/AGENTS.md', '# rules')).toMatchObject({ kind: 'rule', target: 'workspace.agents', reasonCode: 'rules-file' })
    expect(codexAdapter.classify('.codex/prompts/plan.md', '# plan')).toMatchObject({ kind: 'skill', target: 'skill', reasonCode: 'slash-command' })
  })

  // A scan rooted INSIDE ~/.codex has no marker segment left in its relative
  // paths, so the owner's chosen profile is the only signal that these files
  // are Codex's.
  describe('rooted inside ~/.codex, claimed by the chosen profile', () => {
    const codex = { profile: 'codex' as const }
    const claim = (rel: string, head = '') => codexAdapter.classify(rel, head, codex)

    it('claims the configuration and credential files', () => {
      expect(claim('config.toml')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
      expect(claim('auth.json')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
      expect(claim('version.json')).toMatchObject({ kind: 'knowledge', reasonCode: 'config' })
    })

    it('claims derived state — databases, their sidecars and locks', () => {
      expect(claim('memories_1.sqlite')).toMatchObject({ kind: 'memory', reasonCode: 'memory-note' })
      expect(claim('memories_1.sqlite-wal')).toMatchObject({ kind: 'noise', reasonCode: 'derived-index' })
      expect(claim('memories_1.sqlite-shm')).toMatchObject({ kind: 'noise', reasonCode: 'derived-index' })
      expect(claim('codex.lock')).toMatchObject({ kind: 'noise', reasonCode: 'derived-index' })
      // The command history is text the owner typed, so it is listed, not dropped.
      expect(claim('history.jsonl')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
    })

    it('claims the instruction file, the prompts and the skill packages', () => {
      expect(claim('AGENTS.md', '# rules')).toMatchObject({ kind: 'rule', target: 'workspace.agents', reasonCode: 'rules-file', selectedByDefault: true })
      expect(claim('prompts/plan.md', '# plan')).toMatchObject({ kind: 'skill', target: 'skill', reasonCode: 'slash-command', selectedByDefault: true })
      expect(claim('skills/alpha-helper/SKILL.md', '# helper')).toMatchObject({ kind: 'skill', target: 'skill', reasonCode: 'skill-package', selectedByDefault: true })
    })

    it('claims session rollouts under sessions/', () => {
      expect(claim('sessions/2026/01/02/rollout-2026-01-02T10-00-00-abc.jsonl')).toMatchObject({
        kind: 'session',
        target: 'episodic',
        reasonCode: 'transcript',
        selectedByDefault: true,
      })
    })

    it('answers for none of those names without the profile and without a .codex segment', () => {
      // Another provider's root must be unaffected: these are somebody else's
      // files until the owner says the scan is a Codex tree.
      for (const rel of ['config.toml', 'auth.json', 'version.json', 'AGENTS.md', 'prompts/plan.md', 'skills/alpha-helper/SKILL.md', 'history.jsonl', 'codex.lock']) {
        expect(codexAdapter.classify(rel, '')).toBeNull()
      }
    })

    it('leaves another tool\'s derived state alone at any depth', () => {
      // The scan root under a profile-only match may be a home directory.
      expect(claim('.grok/memory/proj-1/index.sqlite')).toBeNull()
      expect(claim('some/other/tool/cache.lock')).toBeNull()
      expect(claim('.cursor/logs/history.jsonl')).toBeNull()
      // Codex's own derived state, in the tree or at the codex root, still is.
      expect(claim('.codex/memory/index.sqlite')).toMatchObject({ kind: 'noise', reasonCode: 'derived-index' })
      expect(claim('memories_1.sqlite-wal')).toMatchObject({ kind: 'noise', reasonCode: 'derived-index' })
    })

    it('takes rollouts from the sessions directory at the codex root, not any nested one', () => {
      expect(claim('sessions/2026/01/02/rollout-x.jsonl')).toMatchObject({ kind: 'session', reasonCode: 'transcript' })
      expect(claim('foo/sessions/rollout-x.jsonl')).toBeNull()
    })

    it('does not swallow unrelated files just because the profile is codex', () => {
      expect(claim('projects/alpha/notes.md', '# notes')).toBeNull()
      expect(claim('nested/deep/config.toml')).toBeNull()
    })
  })

  // A claimed container that expanded to nothing would leave the scanner to
  // fall back to a whole-file row, and the "text" of that row would be the
  // decoded bytes of a binary database. The file stays visible and says why —
  // and the row it shows must be TRUE, which is what the four shapes below pin.
  const memoryDb = (name: string, rows: string[], schema = SCHEMA): Buffer => {
    const path = join(root, '.codex', name)
    const db = openDatabase(path)
    db.run(schema)
    for (const row of rows) db.run(row)
    db.close()
    return readFileSync(path)
  }

  it.skipIf(!hasBunSqlite)('says a memory database holds no rows only when the table is missing', () => {
    const path = join(root, '.codex', 'memories_2.sqlite')
    const db = openDatabase(path)
    db.run('CREATE TABLE other (id TEXT)')
    db.close()
    const units = codexAdapter.expand!('.codex/memories_2.sqlite', readFileSync(path), path)
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({
      unit: 'empty',
      title: 'memories_2.sqlite',
      content: '',
      hint: { kind: 'noise', target: 'none', reasonCode: 'empty', selectedByDefault: false },
    })
    expect(units[0].hint.reason).toMatch(/no memory rows/)
  })

  it.skipIf(!hasBunSqlite)('says the same for a table that is there and empty', () => {
    const raw = memoryDb('memories_3.sqlite', [])
    const [unit] = codexAdapter.expand!('.codex/memories_3.sqlite', raw, join(root, '.codex', 'memories_3.sqlite'))
    expect(unit).toMatchObject({ unit: 'empty', hint: { reasonCode: 'empty' } })
    expect(unit.hint.reason).toMatch(/no memory rows/)
  })

  // A thread id is a slug input, not a licence to exist. A row that carries the
  // owner's words is imported whether or not the database named its thread.
  it.skipIf(!hasBunSqlite)('keeps a row whose thread id is empty or NULL, under a name of its own', () => {
    const raw = memoryDb('memories_4.sqlite', [
      `INSERT INTO stage1_outputs VALUES ('', 1767340800000, 'charlie memory the owner wrote', '', NULL, 1767340800000)`,
      `INSERT INTO stage1_outputs VALUES (NULL, 1767340700000, 'delta memory the owner wrote', '', 'delta-slug', 1767340700000)`,
    ])
    const units = codexAdapter.expand!('.codex/memories_4.sqlite', raw, join(root, '.codex', 'memories_4.sqlite'))
    expect(units).toHaveLength(2)
    expect(units.map((u) => u.content)).toEqual([
      'charlie memory the owner wrote',
      'delta memory the owner wrote',
    ])
    // Named after its own content plus SQLite's own row key, so the name is
    // unique in the database AND survives the database changing.
    expect(units[0].unit).toMatch(/^unthreaded-[0-9a-f]{12}-r\d+$/)
    expect(units[0].title).toBe('charlie memory the owner wrote')
    expect(units[1].title).toBe('delta-slug')
    expect(units.every((u) => u.data?.unthreaded === true)).toBe(true)
    expect(units.every((u) => u.hint.kind === 'memory' && u.hint.selectedByDefault)).toBe(true)
    // Twice over the same database gives the same names — a re-import adds nothing.
    expect(codexAdapter.expand!('.codex/memories_4.sqlite', raw, join(root, '.codex', 'memories_4.sqlite')).map((u) => u.unit))
      .toEqual(units.map((u) => u.unit))
  })

  it.skipIf(!hasBunSqlite)('keeps both the threaded and the unthreaded rows of a mixed table', () => {
    const raw = memoryDb('memories_5.sqlite', [
      `INSERT INTO stage1_outputs VALUES ('t-alpha', 1767340900000, 'alpha memory', 'alpha summary', 'alpha-slug', 1767340900000)`,
      `INSERT INTO stage1_outputs VALUES ('', 1767340800000, 'charlie memory the owner wrote', '', NULL, 1767340800000)`,
    ])
    const units = codexAdapter.expand!('.codex/memories_5.sqlite', raw, join(root, '.codex', 'memories_5.sqlite'))
    expect(units).toHaveLength(2)
    expect(units[0]).toMatchObject({ unit: 't-alpha', title: 'alpha-slug' })
    expect(units[1].unit).toMatch(/^unthreaded-/)
    expect(units.map((u) => u.content).join('\n')).toContain('charlie memory the owner wrote')
  })

  // N-1: two rows may hold the very same words. One id for both would make the
  // runner write one body twice and never reach the second row — the silent
  // loss this wave exists to remove.
  it.skipIf(!hasBunSqlite)('tells two unthreaded rows with identical text apart', () => {
    const same = 'the very same words in both rows'
    const raw = memoryDb('memories_7.sqlite', [
      `INSERT INTO stage1_outputs VALUES ('', 1767340800000, '${same}', '', NULL, 1767340800000)`,
      `INSERT INTO stage1_outputs VALUES (NULL, 1767340800000, '${same}', '', NULL, 1767340800000)`,
    ])
    const units = codexAdapter.expand!('.codex/memories_7.sqlite', raw, join(root, '.codex', 'memories_7.sqlite'))
    expect(units).toHaveLength(2)
    expect(new Set(units.map((u) => u.unit)).size).toBe(2)
    expect(units.map((u) => u.content)).toEqual([same, same])
  })

  it.skipIf(!hasBunSqlite)('keeps every synthesised name when the database is read again, reordered and grown', () => {
    const path = join(root, '.codex', 'memories_13.sqlite')
    const db = openDatabase(path)
    db.run(SCHEMA)
    db.run(`INSERT INTO stage1_outputs VALUES ('', 1767340800000, 'charlie memory', '', NULL, 1767340800000)`)
    db.run(`INSERT INTO stage1_outputs VALUES (NULL, 1767340700000, 'delta memory', '', NULL, 1767340700000)`)
    db.close()
    const read = () => codexAdapter.expand!('.codex/memories_13.sqlite', readFileSync(path), path)
    const before = new Map(read().map((u) => [u.content, u.unit]))
    expect(before.size).toBe(2)

    // The same database later: one row is newer than it was, so the order the
    // rows come back in changes, and a row is added beside them.
    const db2 = openDatabase(path)
    db2.run(`UPDATE stage1_outputs SET source_updated_at = 1767341900000 WHERE raw_memory = 'delta memory'`)
    db2.run(`INSERT INTO stage1_outputs VALUES (NULL, 1767341800000, 'echo memory', '', NULL, 1767341800000)`)
    db2.close()
    const after = read()
    expect(after).toHaveLength(3)
    expect(after.find((u) => u.content === 'delta memory')!.unit).toBe(before.get('delta memory'))
    expect(after.find((u) => u.content === 'charlie memory')!.unit).toBe(before.get('charlie memory'))
  })

  it.skipIf(!hasBunSqlite)('leaves a real thread id that looks synthesised with its own unit', () => {
    // The row below is named exactly what the unthreaded row beside it would be
    // called. The real id wins; the synthesised one steps aside.
    const words = 'charlie memory the owner wrote'
    const raw0 = memoryDb('memories_14.sqlite', [
      `INSERT INTO stage1_outputs VALUES ('', 1767340800000, '${words}', '', NULL, 1767340800000)`,
    ])
    const synthesised = codexAdapter.expand!('.codex/memories_14.sqlite', raw0, join(root, '.codex', 'memories_14.sqlite'))[0]!.unit
    expect(synthesised).toMatch(/^unthreaded-/)

    const raw = memoryDb('memories_16.sqlite', [
      `INSERT INTO stage1_outputs VALUES ('${synthesised}', 1767340900000, 'a thread named like a synthesised one', '', NULL, 1767340900000)`,
      `INSERT INTO stage1_outputs VALUES ('', 1767340800000, '${words}', '', NULL, 1767340800000)`,
    ])
    const units = codexAdapter.expand!('.codex/memories_16.sqlite', raw, join(root, '.codex', 'memories_16.sqlite'))
    expect(units).toHaveLength(2)
    expect(units[0]).toMatchObject({ unit: synthesised, content: 'a thread named like a synthesised one' })
    expect(units[1]!.unit).not.toBe(synthesised)
    expect(new Set(units.map((u) => u.unit)).size).toBe(2)
  })

  // N-3: a database whose schema reads but whose data pages do not is not an
  // empty database. Saying "no memory rows" about forty memories the reader
  // could not reach would be the very silence this wave removes.
  it.skipIf(!hasBunSqlite)('says a database it could not read could not be opened, never that it is empty', () => {
    const path = join(root, '.codex', 'memories_17.sqlite')
    const db = openDatabase(path)
    db.run(SCHEMA)
    for (let i = 0; i < 40; i++) {
      db.run(`INSERT INTO stage1_outputs VALUES ('t${i}', ${1767340800000 + i}, '${'memory text '.repeat(60)}${i}', '', NULL, 1)`)
    }
    db.close()
    // The schema page stays; every page after it is wiped, which is what a
    // half-written or damaged file looks like.
    const corrupt = Buffer.from(readFileSync(path))
    corrupt.fill(0, 4096)
    const corruptPath = join(root, '.codex', 'memories_18.sqlite')
    writeFileSync(corruptPath, corrupt)
    // The premise: the table is still listed, and reading its rows fails.
    const probe = openDatabase(corruptPath, { readonly: true })
    expect(probe.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='stage1_outputs'`).get()).toBeTruthy()
    expect(() => probe.prepare('SELECT * FROM stage1_outputs').all()).toThrow()
    probe.close()

    const units = codexAdapter.expand!('.codex/memories_18.sqlite', corrupt, corruptPath)
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({
      unit: 'unavailable',
      content: '',
      hint: { kind: 'noise', target: 'none', reasonCode: 'unreadable', selectedByDefault: false },
    })
    expect(units[0].hint.reason).toMatch(/could not be opened/)
    expect(units[0].hint.reason).not.toMatch(/no memory rows/)
  })

  it.skipIf(!hasBunSqlite)('falls back to an ordinal when the table has no row key', () => {
    const withoutRowid =
      'CREATE TABLE stage1_outputs (thread_id TEXT NOT NULL, source_updated_at INTEGER NOT NULL, raw_memory TEXT NOT NULL, rollout_summary TEXT NOT NULL, rollout_slug TEXT, generated_at INTEGER NOT NULL, PRIMARY KEY (thread_id)) WITHOUT ROWID'
    const raw = memoryDb(
      'memories_10.sqlite',
      [`INSERT INTO stage1_outputs VALUES ('', 1767340800000, 'charlie memory', '', NULL, 1767340800000)`],
      withoutRowid,
    )
    const [unit] = codexAdapter.expand!('.codex/memories_10.sqlite', raw, join(root, '.codex', 'memories_10.sqlite'))
    expect(unit.unit).toMatch(/^unthreaded-[0-9a-f]{12}-n1$/)
    expect(unit.content).toBe('charlie memory')
  })

  // N-2: a row the reader found no text in is counted out loud even when the
  // rest of the table imported fine.
  it.skipIf(!hasBunSqlite)('counts the rows it found no text in beside the units it did make', () => {
    const raw = memoryDb('memories_11.sqlite', [
      `INSERT INTO stage1_outputs VALUES ('t-alpha', 1767340900000, 'alpha memory', '', 'alpha-slug', 1767340900000)`,
      `INSERT INTO stage1_outputs VALUES ('t-blank', 1767340800000, '', '', 'blank-slug', 1767340800000)`,
      `INSERT INTO stage1_outputs VALUES ('t-blank-2', 1767340700000, '   ', '', NULL, 1767340700000)`,
    ])
    const units = codexAdapter.expand!('.codex/memories_11.sqlite', raw, join(root, '.codex', 'memories_11.sqlite'))
    expect(units).toHaveLength(2)
    expect(units[0]).toMatchObject({ unit: 't-alpha', hint: { kind: 'memory' } })
    const accounting = units[1]!
    expect(accounting).toMatchObject({ unit: 'empty', content: '', hint: { kind: 'noise', reasonCode: 'empty', selectedByDefault: false } })
    expect(accounting.hint.reason).toBe('2 rows of 3 in this Codex memory database hold no text')
  })

  it.skipIf(!hasBunSqlite)('makes the verb agree when a single row holds no text', () => {
    const raw = memoryDb('memories_19.sqlite', [
      `INSERT INTO stage1_outputs VALUES ('t-alpha', 1767340900000, 'alpha memory', '', 'alpha-slug', 1767340900000)`,
      `INSERT INTO stage1_outputs VALUES ('t-blank', 1767340800000, '', '', 'blank-slug', 1767340800000)`,
    ])
    const units = codexAdapter.expand!('.codex/memories_19.sqlite', raw, join(root, '.codex', 'memories_19.sqlite'))
    expect(units[1]!.hint.reason).toBe('1 row of 2 in this Codex memory database holds no text')
    // …and the same agreement when the one row is all there is.
    const blank = memoryDb('memories_20.sqlite', [
      `INSERT INTO stage1_outputs VALUES ('t-blank', 1767340800000, '', '', 'blank-slug', 1767340800000)`,
    ])
    const [only] = codexAdapter.expand!('.codex/memories_20.sqlite', blank, join(root, '.codex', 'memories_20.sqlite'))
    expect(only.hint.reason).toBe('Codex memory database whose 1 row holds no text')
  })

  it.skipIf(!hasBunSqlite)('says how many rows it could not read text in, rather than claiming there are none', () => {
    const raw = memoryDb('memories_6.sqlite', [
      `INSERT INTO stage1_outputs VALUES ('t-blank', 1767340800000, '', '', NULL, 1767340800000)`,
      `INSERT INTO stage1_outputs VALUES ('t-blank-2', 1767340700000, '   ', '', NULL, 1767340700000)`,
    ])
    const [unit] = codexAdapter.expand!('.codex/memories_6.sqlite', raw, join(root, '.codex', 'memories_6.sqlite'))
    expect(unit).toMatchObject({ unit: 'empty', hint: { reasonCode: 'empty', selectedByDefault: false } })
    expect(unit.hint.reason).toMatch(/2 rows hold no text/)
    expect(unit.hint.reason).not.toMatch(/no memory rows/)
  })

  // A5.2 — read() serves WHOLE files only; a container's units come from expand.
  it('reads a whole non-container file as a plain source note', () => {
    const note = codexAdapter.read!('.codex/AGENTS.md', Buffer.from('---\ntitle: Rules\n---\nBe brief.\n', 'utf-8'), null)
    expect(note.title).toBe('Rules')
    // The body is verbatim, trailing newline included (R11.5).
    expect(note.body).toBe('Be brief.\n')
    expect(note.declaredKind).toBeNull()
  })
})
