// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { chatExportAdapter, decodedByteLength, renderRoleLines } from '@modules/data-port/adapters/chat-export'
import { classifyFile } from '@modules/data-port/adapters/registry'
import { claudeCodeAdapter } from '@modules/data-port/adapters/claude-code'
import { cursorAdapter } from '@modules/data-port/adapters/cursor'

const CHATGPT = JSON.stringify([{
  id: 'c1', title: 'Bun setup', create_time: 1767340800,
  mapping: {
    root: { id: 'root', parent: null, children: ['m1'], message: null },
    m1: { id: 'm1', parent: 'root', children: ['m2'], message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['hello'] }, create_time: 1767340800 } },
    m2: { id: 'm2', parent: 'm1', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['hi'] }, create_time: 1767340801 } },
  },
}])
/** An edited turn: two sibling answers, and `current_node` names the FIRST — the kept one. */
const CHATGPT_EDITED = JSON.stringify([{
  id: 'c2', title: 'Edited', create_time: 1767340800, current_node: 'a1',
  mapping: {
    root: { id: 'root', parent: null, children: ['m1'], message: null },
    m1: { id: 'm1', parent: 'root', children: ['a1', 'a2'], message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['question'] } } },
    a1: { id: 'a1', parent: 'm1', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['kept answer'] } } },
    a2: { id: 'a2', parent: 'm1', children: ['a3'], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['abandoned answer'] } } },
    a3: { id: 'a3', parent: 'a2', children: [], message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['abandoned follow-up'] } } },
  },
}])
const CHATGPT_SYSTEM = JSON.stringify([{
  id: 'c3', title: 'With system', current_node: 'm2',
  mapping: {
    root: { id: 'root', parent: null, children: ['s1'], message: null },
    s1: { id: 's1', parent: 'root', children: ['m1'], message: { author: { role: 'system' }, content: { content_type: 'text', parts: ['Be brief.'] } } },
    m1: { id: 'm1', parent: 's1', children: ['m2'], message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['hello'] } } },
    m2: { id: 'm2', parent: 'm1', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['hi'] } } },
  },
}])
const CLAUDE_AI = JSON.stringify([{ uuid: 'u1', name: 'Plan', created_at: '2026-01-02T10:00:00Z', chat_messages: [
  { sender: 'human', text: 'hello', created_at: '2026-01-02T10:00:00Z' },
  { sender: 'assistant', text: 'hi', created_at: '2026-01-02T10:00:01Z' },
] }])
const GENERIC = JSON.stringify([{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }])
const JSONL = '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi"}\n'
const MEM0 = JSON.stringify({ memories: [{ id: 'm-1', memory: 'Likes bun', created_at: '2026-01-02T10:00:00Z' }] })

describe('chat-export adapter', () => {
  it('detects conversations.json and jsonl', () => {
    expect(chatExportAdapter.detect(['conversations.json'])).toBeGreaterThan(0.5)
    expect(chatExportAdapter.detect(['chat.jsonl'])).toBeGreaterThan(0.5)
  })
  it('renders a ChatGPT mapping tree in order', () => {
    const u = chatExportAdapter.expand!('conversations.json', Buffer.from(CHATGPT))
    expect(u).toHaveLength(1)
    expect(u[0]).toMatchObject({ unit: 'c1', title: 'Bun setup', sessionId: 'c1', sessionDate: '2026-01-02T08:00:00.000Z' })
    expect(u[0].content).toBe('**user:** hello\n\n**assistant:** hi')
    expect(u[0].hint).toMatchObject({ kind: 'session', target: 'episodic', selectedByDefault: true })
  })
  it('renders a Claude.ai export', () => {
    const u = chatExportAdapter.expand!('conversations.json', Buffer.from(CLAUDE_AI))
    expect(u[0]).toMatchObject({ unit: 'u1', title: 'Plan', sessionDate: '2026-01-02T10:00:00.000Z' })
    expect(u[0].content).toBe('**user:** hello\n\n**assistant:** hi')
  })
  it('renders generic role/content JSON and JSONL as one session', () => {
    expect(chatExportAdapter.expand!('x.json', Buffer.from(GENERIC))[0].content).toBe('**user:** hello\n\n**assistant:** hi')
    expect(chatExportAdapter.expand!('x.jsonl', Buffer.from(JSONL))[0].content).toBe('**user:** hello\n\n**assistant:** hi')
  })
  it('turns Mem0-style memories into memory units', () => {
    const u = chatExportAdapter.expand!('memories.json', Buffer.from(MEM0))
    expect(u[0]).toMatchObject({ unit: 'm-1', hint: { kind: 'memory', target: 'vault.semantic', selectedByDefault: true } })
    expect(u[0].content).toBe('Likes bun')
    const note = chatExportAdapter.read!('memories.json', Buffer.from(MEM0), 'm-1')
    expect(note.body).toBe('Likes bun')
    expect(note.created).toBe('2026-01-02')
  })
  it('keeps unknown JSON as a visible, unticked row that still carries its bytes', () => {
    const u = chatExportAdapter.expand!('settings.json', Buffer.from('{"theme":"dark"}'))
    expect(u).toHaveLength(1)
    expect(u[0].hint).toMatchObject({ kind: 'knowledge', target: 'vault.semantic', selectedByDefault: false })
    expect(u[0].content).toBe('{"theme":"dark"}')
  })
})

describe('chat-export adapter — units, codes and claims', () => {
  it('gives every unit one of the task reason codes', () => {
    expect(chatExportAdapter.expand!('conversations.json', Buffer.from(CHATGPT))[0].hint.reasonCode).toBe('transcript')
    expect(chatExportAdapter.expand!('memories.json', Buffer.from(MEM0))[0].hint.reasonCode).toBe('memory-note')
    expect(chatExportAdapter.expand!('settings.json', Buffer.from('{"theme":"dark"}'))[0].hint.reasonCode).toBe('unknown-json')
  })

  it('names broken JSON invalid rather than dropping the file', () => {
    const u = chatExportAdapter.expand!('conversations.json', Buffer.from('{"not closed'))
    expect(u).toHaveLength(1)
    expect(u[0].hint).toMatchObject({ kind: 'knowledge', reasonCode: 'invalid-json', selectedByDefault: false })
    // The bytes nobody could parse are still the row's content (R11).
    expect(u[0].content).toBe('{"not closed')
    const lines = chatExportAdapter.expand!('x.jsonl', Buffer.from('{"not closed\nalso broken\n'))
    expect(lines[0].hint.reasonCode).toBe('invalid-json')
  })

  it('carries the Mem0 object, created and updated on the unit itself', () => {
    const raw = Buffer.from(JSON.stringify({ results: [{ id: 'm-2', memory: 'Prefers dark mode', created_at: '2026-01-02T10:00:00Z', updated_at: '2026-03-04T10:00:00Z' }] }))
    const u = chatExportAdapter.expand!('memories.json', raw)[0]
    expect(u.data).toMatchObject({ id: 'm-2', memory: 'Prefers dark mode' })
    expect(u.created).toBe('2026-01-02')
    expect(u.updated).toBe('2026-03-04')
  })

  it('reads a whole file as a plain source note when no unit is named', () => {
    const note = chatExportAdapter.read!('memories.json', Buffer.from(MEM0), null)
    expect(note.body).toContain('"memory"')
    expect(note.sessionId).toBeNull()
  })

  it('marks a conversation with no turns empty instead of importing a blank note', () => {
    const raw = Buffer.from(JSON.stringify([{ uuid: 'u2', name: 'Silent', created_at: '2026-01-02T10:00:00Z', chat_messages: [] }]))
    const u = chatExportAdapter.expand!('conversations.json', raw)[0]
    expect(u.hint).toMatchObject({ kind: 'noise', reasonCode: 'empty', selectedByDefault: false })
  })

  it('claims the documented export names anywhere, other JSON only when picked', () => {
    expect(chatExportAdapter.classify('conversations.json', '[{')).toMatchObject({ kind: 'session', reasonCode: 'transcript' })
    expect(chatExportAdapter.classify('memories.json', '{')).toMatchObject({ kind: 'memory', reasonCode: 'memory-note' })
    expect(chatExportAdapter.classify('notes/a.md', '# n')).toBeNull()
    // Not a documented name and the owner picked another provider: leave it alone.
    expect(chatExportAdapter.classify('data/rows.json', '[', { profile: 'claude-code' })).toBeNull()
    expect(chatExportAdapter.classify('data/rows.json', '[', { profile: 'chat-export' })).not.toBeNull()
    // Toolchain JSON is never a chat export, even under an explicit pick.
    expect(chatExportAdapter.classify('package.json', '{', { profile: 'chat-export' })).toBeNull()
    expect(chatExportAdapter.classify('manifest.json', '{', { profile: 'chat-export' })).toBeNull()
  })

  it('says its shapes are unverified in the wizard hints', () => {
    expect(chatExportAdapter.rootHints.join(' ')).toMatch(/unverified/i)
  })
})

describe('chat-export adapter — ChatGPT branches and system turns', () => {
  it('follows current_node, not the last sibling, for the active branch', () => {
    const u = chatExportAdapter.expand!('conversations.json', Buffer.from(CHATGPT_EDITED))
    expect(u[0].content.split('## Other branches')[0].trim()).toBe('**user:** question\n\n**assistant:** kept answer')
  })

  it('keeps every abandoned branch under Other branches, named by its fork point', () => {
    const u = chatExportAdapter.expand!('conversations.json', Buffer.from(CHATGPT_EDITED))
    expect(u[0].content).toBe(
      '**user:** question\n\n**assistant:** kept answer\n\n' +
        '## Other branches\n\n### branch from m1\n\n' +
        '**assistant:** abandoned answer\n\n**user:** abandoned follow-up',
    )
  })

  it('falls back to the last child when current_node is absent or dangling', () => {
    expect(chatExportAdapter.expand!('conversations.json', Buffer.from(CHATGPT))[0].content).toBe(
      '**user:** hello\n\n**assistant:** hi',
    )
    const dangling = JSON.parse(CHATGPT_EDITED)
    dangling[0].current_node = 'gone'
    const u = chatExportAdapter.expand!('conversations.json', Buffer.from(JSON.stringify(dangling)))
    // Last child of m1 is a2, so a2's branch is active and a1 becomes the other branch.
    expect(u[0].content.split('## Other branches')[0].trim()).toBe(
      '**user:** question\n\n**assistant:** abandoned answer\n\n**user:** abandoned follow-up',
    )
    expect(u[0].content).toContain('### branch from m1\n\n**assistant:** kept answer')
  })

  it('sanitises a hostile fork-point id in the branch heading', () => {
    const hostile = JSON.stringify([{
      id: 'c4', current_node: 'a1',
      mapping: {
        'evil\nid': { parent: null, children: ['a1', 'a2'], message: null },
        a1: { parent: 'evil\nid', children: [], message: { author: { role: 'user' }, content: { parts: ['kept'] } } },
        a2: { parent: 'evil\nid', children: [], message: { author: { role: 'assistant' }, content: { parts: ['other'] } } },
      },
    }])
    const u = chatExportAdapter.expand!('conversations.json', Buffer.from(hostile))
    expect(u[0].content).toBe('**user:** kept\n\n## Other branches\n\n### branch from evil id\n\n**assistant:** other')
  })

  it('renders system turns in place instead of dropping them', () => {
    const u = chatExportAdapter.expand!('conversations.json', Buffer.from(CHATGPT_SYSTEM))
    expect(u[0].content).toBe('**system:** Be brief.\n\n**user:** hello\n\n**assistant:** hi')
  })

  it('leaves a single-branch conversation with no Other branches section', () => {
    expect(chatExportAdapter.expand!('conversations.json', Buffer.from(CHATGPT))[0].content).not.toContain('Other branches')
  })
})

describe('chat-export adapter — reversibility, unparsed lines and claims', () => {
  it('escapes a role marker inside turn text so it cannot fake a turn boundary', () => {
    const raw = Buffer.from(JSON.stringify([{ role: 'user', content: 'see:\n\n**assistant:** fake' }]))
    const u = chatExportAdapter.expand!('x.json', raw)
    expect(u).toHaveLength(1)
    expect(u[0].content).toBe('**user:** see:\n\n\\**assistant:** fake')
  })

  it('escapes a section heading inside turn text so it cannot imitate a section', () => {
    const raw = Buffer.from(JSON.stringify([{ role: 'user', content: 'note:\n\n## Other branches\n\n### branch from x' }]))
    const u = chatExportAdapter.expand!('x.json', raw)
    expect(u).toHaveLength(1)
    expect(u[0].content).toBe('**user:** note:\n\n\\## Other branches\n\n\\### branch from x')
  })

  it('keeps unparseable JSONL lines verbatim and says how many there were', () => {
    const raw = Buffer.from('{"role":"user","content":"hello"}\n{ broken\n{"role":"assistant","content":"hi"}\n')
    const u = chatExportAdapter.expand!('x.jsonl', raw)
    expect(u).toHaveLength(1)
    expect(u[0].content).toBe('**user:** hello\n\n**assistant:** hi\n\n## Unparsed lines\n\n```text\n{ broken\n```')
    expect(u[0].hint.reason).toContain('1 line could not be parsed')
    expect(u[0].preview).toContain('1 line could not be parsed')
  })

  it('counts the lines it could not read even when none of them parsed', () => {
    const u = chatExportAdapter.expand!('x.jsonl', Buffer.from('{ broken\nalso broken\n'))
    expect(u[0].hint.reasonCode).toBe('invalid-json')
    expect(u[0].hint.reason).toContain('2 lines could not be parsed')
  })

  it('claims every .jsonl file, and plain .json only when picked', () => {
    expect(chatExportAdapter.classify('logs/anything.jsonl', '{"role":"user"}')).toMatchObject({ kind: 'session' })
    const claimed = classifyFile('logs/anything.jsonl', '{"role":"user"}', 'claude-code')
    expect(claimed.adapterId).toBe('chat-export')
    expect(claimed.hint.kind).toBe('session')
    expect(chatExportAdapter.classify('data/rows.json', '[', { profile: 'claude-code' })).toBeNull()
  })

  it('omits created and updated on a dateless unit rather than nulling them', () => {
    const u = chatExportAdapter.expand!('x.json', Buffer.from(GENERIC))[0]
    expect('created' in u).toBe(false)
    expect('updated' in u).toBe(false)
    // A dated conversation still carries them.
    const dated = chatExportAdapter.expand!('conversations.json', Buffer.from(CLAUDE_AI))[0]
    expect(dated.created).toBe('2026-01-02')
  })
})

describe('chat-export adapter — provider transcripts stay with their provider', () => {
  const CLAUDE = '.claude/projects/-alpha-bravo/abc.jsonl'
  const CURSOR = '.cursor/projects/p/agent-transcripts/a/b.jsonl'
  const CURSOR_FLAT = '.cursor/projects/p/agent-transcripts/b.jsonl'
  const CODEX = '.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-abc.jsonl'
  const CODEX_ROOTED = 'sessions/2026/01/02/rollout-2026-01-02T10-00-00-abc.jsonl'

  it('refuses a provider transcript path whatever the profile says', () => {
    for (const rel of [CLAUDE, CURSOR, CURSOR_FLAT, CODEX, CODEX_ROOTED]) {
      expect(chatExportAdapter.classify(rel, '{"role":"user"}')).toBeNull()
      expect(chatExportAdapter.classify(rel, '{"role":"user"}', { profile: 'chat-export' })).toBeNull()
    }
  })

  it('leaves them with their own adapter even under an explicit chat-export pick', () => {
    expect(classifyFile(CLAUDE, '{"role":"user"}', 'chat-export').adapterId).toBe('claude-code')
    expect(classifyFile(CURSOR, '{"role":"user"}', 'chat-export').adapterId).toBe('cursor')
    expect(classifyFile(CODEX, '{"role":"user"}', 'chat-export').adapterId).toBe('codex')
  })

  it('still claims a stray .jsonl that belongs to nobody', () => {
    expect(classifyFile('logs/anything.jsonl', '{"role":"user"}', 'chat-export').adapterId).toBe('chat-export')
  })
})

describe('chat-export adapter — every JSONL line shape renders its body', () => {
  it('reads the Claude Code, Cursor and plain line shapes from a stray .jsonl', () => {
    const claude = '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}\n'
    const cursor = '{"role":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}\n'
    const plain = '{"role":"user","content":"bye"}\n'
    const u = chatExportAdapter.expand!('logs/x.jsonl', Buffer.from(claude + cursor + plain))
    expect(u).toHaveLength(1)
    expect(u[0].content).toBe('**user:** hello\n\n**assistant:** hi\n\n**user:** bye')
    expect(u[0].hint).toMatchObject({ kind: 'session', target: 'episodic', reasonCode: 'transcript' })
  })

  it('renders the body of each documented line shape', () => {
    const shapes: Array<[string, string]> = [
      ['{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}', '**user:** hello'],
      ['{"role":"user","message":{"content":[{"text":"hello"}]}}', '**user:** hello'],
      ['{"role":"user","parts":[{"text":"hello"}]}', '**user:** hello'],
      ['{"role":"model","parts":[{"text":"hi"}]}', '**model:** hi'],
    ]
    for (const [line, expected] of shapes) {
      const u = chatExportAdapter.expand!('logs/x.jsonl', Buffer.from(line + '\n'))
      expect(u[0].content).toBe(expected)
      expect(u[0].hint.reasonCode).toBe('transcript')
    }
  })

  it('widens the unparsed fence past any backtick run in the kept lines', () => {
    const raw = Buffer.from('{"role":"user","content":"hello"}\n```json\n')
    const u = chatExportAdapter.expand!('logs/x.jsonl', raw)
    expect(u[0].content).toBe('**user:** hello\n\n## Unparsed lines\n\n````text\n```json\n````')
  })

  it('falls back to memory rows when a .jsonl holds no turns at all', () => {
    const raw = Buffer.from('{"id":"m-1","memory":"Likes bun"}\n{"id":"m-2","memory":"Prefers dark mode"}\n')
    const u = chatExportAdapter.expand!('logs/memories.jsonl', raw)
    expect(u).toHaveLength(2)
    expect(u.map((x) => x.unit)).toEqual(['m-1', 'm-2'])
    expect(u.map((x) => x.content)).toEqual(['Likes bun', 'Prefers dark mode'])
    expect(u.every((x) => x.hint.kind === 'memory' && x.hint.reasonCode === 'memory-note')).toBe(true)
  })

  it('keeps unparsed lines out of a memory note body, as their own row', () => {
    const raw = Buffer.from('{"id":"m-1","memory":"Likes bun"}\n{ broken\n{"id":"m-2","memory":"Prefers dark mode"}\n')
    const u = chatExportAdapter.expand!('logs/memories.jsonl', raw)
    expect(u).toHaveLength(3)
    const memories = u.filter((x) => x.hint.kind === 'memory')
    expect(memories).toHaveLength(2)
    expect(memories.some((x) => x.content.includes('## Unparsed lines'))).toBe(false)
    const row = u[u.length - 1]
    expect(row).toMatchObject({ unit: 'unparsed', hint: { kind: 'knowledge', reasonCode: 'invalid-json' } })
    expect(row.content).toContain('{ broken')
    expect(row.hint.reason).toContain('1 line could not be parsed')
    // A Mem0 JSON document has no per-line parsing, so it never gets a section.
    const doc = chatExportAdapter.expand!('memories.json', Buffer.from(MEM0))
    expect(doc.every((x) => x.hint.kind === 'memory')).toBe(true)
    expect(doc.some((x) => x.content.includes('## Unparsed lines'))).toBe(false)
  })

  it('ignores non-turn line types the way the provider readers do', () => {
    const raw = Buffer.from(
      '{"type":"summary","summary":"ignored","sessionId":"s-7"}\n' +
        '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}\n',
    )
    const u = chatExportAdapter.expand!('logs/x.jsonl', raw)
    expect(u[0].content).toBe('**user:** hello')
    expect(u[0].sessionId).toBe('s-7')
  })
})

describe('renderRoleLines', () => {
  const CLAUDE_LINES = [
    '{"type":"summary","summary":"ignored","sessionId":"s-1"}',
    '{"type":"user","sessionId":"s-1","timestamp":"2026-01-02T10:00:00Z","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}',
    '{"type":"assistant","sessionId":"s-1","timestamp":"2026-01-02T10:00:01Z","message":{"role":"assistant","content":[{"type":"text","text":"hi"},{"type":"tool_use","name":"Read"}]}}',
    '',
  ].join('\n')

  const CURSOR_LINES = [
    '{"role":"user","message":{"content":[{"type":"text","text":"hello"}]}}',
    '{"role":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}',
    '',
  ].join('\n')

  it('renders Claude Code lines, ignores other line types and fences non-text parts', () => {
    const r = renderRoleLines(Buffer.from(CLAUDE_LINES))
    expect(r.content).toBe('**user:** hello\n\n**assistant:** hi\n```json\n{"type":"tool_use","name":"Read"}\n```')
    expect(r.sessionId).toBe('s-1')
    expect(r.sessionDate).toBe('2026-01-02T10:00:00.000Z')
  })

  it('renders Cursor role/message lines with no session fields', () => {
    const r = renderRoleLines(Buffer.from(CURSOR_LINES))
    expect(r.content).toBe('**user:** hello\n\n**assistant:** hi')
    expect(r.sessionId).toBeNull()
    expect(r.sessionDate).toBeNull()
  })

  it('keeps an unparseable line instead of failing or dropping the transcript', () => {
    const r = renderRoleLines(Buffer.from('{ broken\n{"role":"user","content":"hello"}\n'))
    expect(r.content).toBe('**user:** hello\n\n## Unparsed lines\n\n```text\n{ broken\n```')
    expect(r.turns).toBe(1)
  })

  it('takes session_id and created_at spellings too', () => {
    const r = renderRoleLines(Buffer.from('{"session_id":"s-2","created_at":"2026-05-06T07:08:09Z","role":"user","content":"x"}\n'))
    expect(r.sessionId).toBe('s-2')
    expect(r.sessionDate).toBe('2026-05-06T07:08:09.000Z')
  })
})

describe('renderRoleLines — streaming, counting and parts', () => {
  it('iterates lines without building the whole-file string', () => {
    const raw = Buffer.from(
      Array.from({ length: 20000 }, (_, i) =>
        JSON.stringify({ type: 'user', message: { role: 'user', content: `alpha ${i}` }, timestamp: '2026-01-01T00:00:00Z' }),
      ).join('\r\n'),
    )
    const spy = vi.spyOn(Buffer.prototype, 'toString')
    const r = renderRoleLines(raw)
    // Every read of the transcript names a line range: the whole file is never
    // decoded into one string, so a tree of them never sits in memory at once.
    const wholeFileReads = spy.mock.contexts.filter(
      (ctx, i) => (ctx as unknown) === (raw as unknown) && (spy.mock.calls[i]?.length ?? 0) < 3,
    )
    spy.mockRestore()
    expect(wholeFileReads).toEqual([])
    expect(r.turns).toBe(20000)
    expect(r.content.startsWith('**user:** alpha 0')).toBe(true)
    // A CRLF transcript renders without the carriage returns.
    expect(r.content).not.toContain('\r')
  })

  it('counts and titles without collecting when asked', () => {
    const raw = Buffer.from(
      [
        JSON.stringify({ type: 'summary', summary: 'Ship alpha' }),
        JSON.stringify({ type: 'ai-title', aiTitle: 'Alpha shipping' }),
        JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: 'injected' } }),
        JSON.stringify({ type: 'system', content: 'system line' }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'sk-alpha_bravo-charlie0123456789 is my key' } }),
        JSON.stringify({ type: 'permission-mode', mode: 'x' }),
      ].join('\n'),
    )
    const full = renderRoleLines(raw)
    const counted = renderRoleLines(raw, { collect: false })
    expect(counted.content).toBe('')
    expect(counted.turns).toBe(full.turns)
    expect(counted.bytes).toBe(Buffer.byteLength(full.content))
    expect(counted.title).toBe('Alpha shipping')
    expect(full.content).toContain('**meta:** injected')
    expect(full.content).toContain('**system:** system line')
    expect(full.metaLines).toBe(1)
    expect(full.secrets).toBe(true)
  })

  it('splits an oversized session into ordered parts whose concatenation is the full render', () => {
    const raw = Buffer.from(
      Array.from({ length: 50 }, (_, i) =>
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'alpha '.repeat(20) + i } }),
      ).join('\n'),
    )
    const units = chatExportAdapter.expand!('x/a.jsonl', raw, undefined, { maxBodyBytes: 800 })
    expect(units.length).toBeGreaterThan(1)
    expect(units.map((u) => u.unit)).toEqual(units.map((_, i) => `transcript#${i + 1}`))
    expect(units.map((u) => u.content).join('\n\n')).toBe(renderRoleLines(raw).content)
    expect(units[0].data).toMatchObject({ part: { n: 1, of: units.length } })
    expect(units[0].tags).toContain(`session-part:1/${units.length}`)
    // No part is larger than the limit, and no byte of the render is lost.
    expect(units.reduce((sum, u) => sum + u.bytes, 0) + 2 * (units.length - 1)).toBe(renderRoleLines(raw).bytes)
  })

  it('counts malformed lines once, so the count-only pass and the collect pass agree on the parts', () => {
    const turns = Array.from({ length: 30 }, (_, i) =>
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'alpha '.repeat(30) + i } }),
    )
    const raw = Buffer.from([turns[0], '{not json', ...turns.slice(1, 15), 'also not json}', ...turns.slice(15)].join('\n'))
    const full = renderRoleLines(raw)
    const counted = renderRoleLines(raw, { collect: false })
    expect(full.unparsed).toHaveLength(2)
    expect(counted.bytes).toBe(Buffer.byteLength(full.content))
    const ids = (withContent: boolean) =>
      chatExportAdapter.expand!('x/a.jsonl', raw, undefined, { withContent, maxBodyBytes: 900 }).map((u) => u.unit)
    expect(ids(false)).toEqual(ids(true))
    expect(ids(true).length).toBeGreaterThan(1)
  })

  it('says the body was counted rather than collected, and keeps the ids either way', () => {
    const raw = Buffer.from('{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi"}\n')
    const [counted] = chatExportAdapter.expand!('x/a.jsonl', raw, undefined, { withContent: false })
    expect(counted).toMatchObject({ unit: 'transcript', content: '', contentOmitted: true, turns: 2 })
    expect(counted.bytes).toBe(Buffer.byteLength('**user:** hello\n\n**assistant:** hi'))
    const [collected] = chatExportAdapter.expand!('x/a.jsonl', raw)
    expect(collected).toMatchObject({ unit: 'transcript', contentOmitted: false })
    expect(collected.content).toBe('**user:** hello\n\n**assistant:** hi')
  })

  it('names a transcript after what it is about, and flags a key without refusing the file', () => {
    const raw = Buffer.from(
      [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Set up the alpha deployment' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'API_KEY=alphabravo0123456789' } }),
      ].join('\n'),
    )
    const [unit] = chatExportAdapter.expand!('x/00000000-0000-4000-8000-00000000ab01.jsonl', raw)
    expect(unit.title).toBe('Set up the alpha deployment')
    expect(unit.tags).toContain('contains-secrets')
    expect(unit.hint.selectedByDefault).toBe(true)
    expect(unit.content).toContain('API_KEY=alphabravo0123456789')
  })
})

describe('renderRoleLines — counting holds no body, and every line lands somewhere', () => {
  /** A file whose lines were half-flushed: 30 % of them are cut mid-JSON. */
  const truncatedCorpus = (turns: number) => {
    const lines: string[] = []
    for (let i = 0; i < turns; i++) {
      const line = JSON.stringify({ type: 'user', message: { role: 'user', content: `alpha ${i} ${'bravo '.repeat(12)}` } })
      lines.push(i % 3 === 0 ? line.slice(0, 60) : line)
    }
    return Buffer.from(lines.join('\n'))
  }

  it('keeps no line and renders no section when it is only counting', () => {
    const raw = truncatedCorpus(9000)
    const counted = renderRoleLines(raw, { collect: false })
    const full = renderRoleLines(raw)
    expect(counted.unparsedCount).toBe(3000)
    expect(counted.unparsedCount).toBe(full.unparsedCount)
    // Nothing on the counted result grows with the file: no kept lines, no
    // rendered section, no blocks, no content — the contract `withContent:
    // false` promises the scan.
    expect(counted.unparsed).toEqual([])
    expect(counted.section).toBe('')
    expect(counted.blocks).toEqual([])
    expect(counted.content).toBe('')
    const retained = counted.section.length + counted.content.length + counted.unparsed.join('').length + counted.blocks.join('').length
    expect(retained).toBe(0)
    // …while the collecting pass, which writes the body, keeps every one.
    expect(full.unparsed).toHaveLength(3000)
    expect(full.section.length).toBeGreaterThan(100_000)
  })

  it('measures the kept section exactly, without rendering it', () => {
    for (const lines of [
      ['{ broken'],
      ['{ broken', 'also broken}'],
      ['``` fenced', '```` wider fence', '{ broken'],
      ['árvíztűrő tükörfúrógép {', 'ünnepélyes }'],
    ]) {
      const raw = Buffer.from([JSON.stringify({ role: 'user', content: 'hello' }), ...lines].join('\n'))
      const counted = renderRoleLines(raw, { collect: false })
      const full = renderRoleLines(raw)
      expect(counted.sectionBytes).toBe(Buffer.byteLength(full.section))
      expect(counted.bytes).toBe(Buffer.byteLength(full.content))
    }
  })

  it('counts the bytes of a decoded buffer without building the string', () => {
    for (const raw of [
      Buffer.from('plain ascii'),
      Buffer.from('árvíztűrő tükörfúrógép — hosszú sor'),
      Buffer.from([0xff, 0xfe, 0x41, 0xc3]),
      Buffer.concat([Buffer.from('alpha '.repeat(20000)), Buffer.from([0xc3])]),
    ]) {
      expect(decodedByteLength(raw)).toBe(Buffer.byteLength(raw.toString('utf-8')))
    }
  })

  it('holds no body for a file no line of which parsed', () => {
    const raw = Buffer.from(Array.from({ length: 2000 }, (_, i) => `{ broken ${i}`).join('\n'))
    const [counted] = chatExportAdapter.expand!('x/a.jsonl', raw, undefined, { withContent: false })
    const [collected] = chatExportAdapter.expand!('x/a.jsonl', raw)
    expect(counted).toMatchObject({ unit: collected.unit, content: '', contentOmitted: true })
    expect(counted.bytes).toBe(collected.bytes)
    expect(collected.content).toBe(raw.toString('utf-8'))
  })

  // Every line that parsed must land in a turn, in `metaLines`, or in the kept
  // lines with its reason — never nowhere. The shapes below are the ones that
  // used to vanish.
  it('accounts for every line of a file that holds one of each shape', () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ type: 'system', subtype: 'stop', durationMs: 12, sessionId: 's' }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: '' }, text: 'the words the owner typed' }),
      JSON.stringify({ note: 'a note nobody can place' }),
      JSON.stringify('a bare string line'),
      JSON.stringify({ type: 'summary', summary: 'first summary' }),
      JSON.stringify({ type: 'summary', summary: 'second summary the owner wrote' }),
      '{not json',
      JSON.stringify({ type: 'permission-mode', mode: 'x' }),
    ]
    const r = renderRoleLines(Buffer.from(lines.join('\n')))
    // 2 turns + 2 meta + 3 kept as written + 1 unparsable + the title line.
    expect(r).toMatchObject({ turns: 2, metaLines: 2, unrenderedCount: 3, unparsedCount: 1, title: 'first summary' })
    expect(r.turns + r.metaLines + r.unrenderedCount + r.unparsedCount + 1).toBe(lines.length)
    // The text of each shape survives: as a turn, or verbatim in the section.
    expect(r.content).toContain('**user:** hello')
    expect(r.content).toContain('**user:** the words the owner typed')
    expect(r.content).toContain('a note nobody can place')
    expect(r.content).toContain('a bare string line')
    expect(r.content).toContain('second summary the owner wrote')
    expect(r.content).toContain('{not json')
    expect(r.keptNote).toBe('1 line could not be parsed; 3 lines kept as written')
  })

  it('names each shape its own disposition', () => {
    const only = (line: string) => renderRoleLines(Buffer.from(`${line}\n`))
    // Bookkeeping with no text: counted, nothing to keep.
    const system = only(JSON.stringify({ type: 'system', subtype: 'stop', durationMs: 12, sessionId: 's' }))
    expect(system).toMatchObject({ turns: 0, metaLines: 1, unrenderedCount: 0 })
    // A role line whose text sits in a slot the first one left empty.
    const displaced = only(JSON.stringify({ type: 'user', message: { role: 'user', content: '' }, text: 'the words' }))
    expect(displaced).toMatchObject({ turns: 1, metaLines: 0 })
    expect(displaced.content).toBe('**user:** the words')
    // A role line with no text anywhere is machinery, and says so.
    const empty = only(JSON.stringify({ type: 'user', message: { role: 'user', content: '' } }))
    expect(empty).toMatchObject({ turns: 0, metaLines: 1, unrenderedCount: 0 })
    // Shapes nobody knows: kept as written.
    for (const line of [JSON.stringify({ note: 'words' }), JSON.stringify('words'), JSON.stringify([1, 2])]) {
      const r = only(line)
      expect(r).toMatchObject({ turns: 0, metaLines: 0, unrenderedCount: 1 })
      expect(r.content).toContain(line)
    }
    // A title line that wins is the title; one it supersedes is kept as written.
    const titles = renderRoleLines(
      Buffer.from([
        JSON.stringify({ type: 'summary', summary: 'the summary' }),
        JSON.stringify({ type: 'ai-title', aiTitle: 'the title' }),
      ].join('\n')),
    )
    expect(titles.title).toBe('the title')
    expect(titles.content).toContain('the summary')
    expect(titles.unrenderedCount).toBe(1)
    // An empty title line carries nothing and is counted, not kept.
    expect(only(JSON.stringify({ type: 'summary', summary: '   ' }))).toMatchObject({ metaLines: 1, unrenderedCount: 0 })
  })

  it('leaves the memory-row fallback alone: only the unreadable lines get a row', () => {
    const raw = Buffer.from(
      ['{"id":"m-1","memory":"Likes bun"}', '{ broken', '{"id":"m-2","memory":"Prefers dark mode"}'].join('\n'),
    )
    const units = chatExportAdapter.expand!('logs/memories.jsonl', raw)
    // Two memory rows and ONE row of unreadable lines — the memory lines are
    // units of their own, so they must not be repeated inside that row.
    expect(units).toHaveLength(3)
    const row = units[units.length - 1]!
    expect(row.unit).toBe('unparsed')
    expect(row.content).toContain('{ broken')
    expect(row.content).not.toContain('Likes bun')
    expect(row.bytes).toBe(Buffer.byteLength(row.content))
  })
})

describe('renderRoleLines — lossless lines and id preference', () => {
  it('appends the unparsed lines verbatim and reports how many', () => {
    const r = renderRoleLines(Buffer.from('{"role":"user","content":"hello"}\n{ broken\n'))
    expect(r.content).toBe('**user:** hello\n\n## Unparsed lines\n\n```text\n{ broken\n```')
    expect(r.unparsed).toEqual(['{ broken'])
    expect(r.turns).toBe(1)
  })

  it('prefers sessionId and session_id over a per-message id', () => {
    expect(renderRoleLines(Buffer.from('{"id":"msg-1","role":"user","content":"x"}\n')).sessionId).toBeNull()
    expect(renderRoleLines(Buffer.from('{"id":"msg-1","role":"user","content":"x"}\n')).messageId).toBe('msg-1')
    const both = renderRoleLines(Buffer.from('{"id":"msg-1","sessionId":"s-3","role":"user","content":"x"}\n'))
    expect(both.sessionId).toBe('s-3')
  })
})

describe('JSONL transcript expansion in the CLI adapters', () => {
  const CLAUDE_REL = '.claude/projects/-alpha-bravo/00000000-0000-4000-8000-00000000ab01.jsonl'
  const CLAUDE_RAW = Buffer.from(
    '{"type":"user","sessionId":"s-9","timestamp":"2026-01-02T10:00:00Z","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}\n' +
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}\n',
  )
  const CURSOR_REL = '.cursor/projects/p/agent-transcripts/abc/abc.jsonl'
  const CURSOR_RAW = Buffer.from(
    '{"role":"user","message":{"content":[{"type":"text","text":"hello"}]}}\n' +
      '{"role":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}\n',
  )

  it('expands a Claude Code transcript into one reversible session unit', () => {
    const u = claudeCodeAdapter.expand!(CLAUDE_REL, CLAUDE_RAW)
    expect(u).toHaveLength(1)
    expect(u[0].content).toBe('**user:** hello\n\n**assistant:** hi')
    expect(u[0]).toMatchObject({ sessionId: 's-9', sessionDate: '2026-01-02T10:00:00.000Z' })
    expect(u[0].hint).toMatchObject({ kind: 'session', target: 'episodic', reasonCode: 'transcript', selectedByDefault: true })
  })

  it('falls back to the transcript filename for the session id', () => {
    const raw = Buffer.from('{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}\n')
    expect(claudeCodeAdapter.expand!(CLAUDE_REL, raw)[0].sessionId).toBe('00000000-0000-4000-8000-00000000ab01')
  })

  // P-5: a sub-agent or workflow transcript is a session of its own. It keeps
  // its own row and says which session ran it, instead of vanishing into that
  // session's note or being dropped for living one directory deeper.
  it('gives a sub-agent and a workflow transcript rows of their own, tagged with their parent', () => {
    const raw = Buffer.from('{"type":"user","message":{"role":"user","content":"hello"}}\n')
    const sid = '00000000-0000-4000-8000-00000000ab01'
    const [sub] = claudeCodeAdapter.expand!(`.claude/projects/-alpha/${sid}/subagents/agent-1a2b.jsonl`, raw)
    expect(sub!.tags).toEqual(expect.arrayContaining(['claude-project:-alpha', 'subagent', `parent-session:${sid}`]))
    expect(sub!.sessionId).toBe('agent-1a2b')
    const [wf] = claudeCodeAdapter.expand!(`.claude/projects/-alpha/${sid}/subagents/workflows/wf_9c80/agent-1a2b.jsonl`, raw)
    expect(wf!.tags).toContain('workflow:wf_9c80')
    expect(wf!.data).toMatchObject({ project: '-alpha', parentSession: sid, workflow: 'wf_9c80', subagent: true })
    const [top] = claudeCodeAdapter.expand!(CLAUDE_REL, raw)
    expect(top!.tags).toEqual(['claude-project:-alpha-bravo'])
    expect(top!.data).toMatchObject({ subagent: false, parentSession: null, workflow: null })
  })

  it('leaves every other Claude Code file to the whole-file path', () => {
    expect(claudeCodeAdapter.expand!('.claude/CLAUDE.md', Buffer.from('# rules'))).toEqual([])
    expect(claudeCodeAdapter.expand!('.claude/settings.json', Buffer.from('{}'))).toEqual([])
  })

  it('expands a Cursor agent transcript into one session unit', () => {
    const u = cursorAdapter.expand!(CURSOR_REL, CURSOR_RAW)
    expect(u).toHaveLength(1)
    expect(u[0].content).toBe('**user:** hello\n\n**assistant:** hi')
    expect(u[0].hint).toMatchObject({ kind: 'session', target: 'episodic', reasonCode: 'transcript' })
    expect(cursorAdapter.expand!('.cursor/rules/alpha-dev.mdc', Buffer.from('# r'))).toEqual([])
  })

  it('marks a transcript with no message turns empty, never a blank session note', () => {
    const raw = Buffer.from('{"type":"summary","summary":"only a summary"}\n')
    const u = claudeCodeAdapter.expand!(CLAUDE_REL, raw)
    expect(u[0].hint).toMatchObject({ kind: 'noise', reasonCode: 'empty', selectedByDefault: false })
  })
  it('prefers the transcript filename over a per-message id', () => {
    const raw = Buffer.from('{"id":"msg-1","type":"user","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}\n')
    expect(claudeCodeAdapter.expand!(CLAUDE_REL, raw)[0].sessionId).toBe('00000000-0000-4000-8000-00000000ab01')
  })

  it('carries the unparsed-line count into the transcript unit reason', () => {
    const raw = Buffer.from('{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}\n{ broken\n')
    const u = claudeCodeAdapter.expand!(CLAUDE_REL, raw)[0]
    expect(u.hint.reason).toContain('1 line could not be parsed')
    expect(u.content).toContain('## Unparsed lines')
  })

  it('classifies and expands a Cursor transcript with or without the id directory', () => {
    const flat = '.cursor/projects/p/agent-transcripts/abc.jsonl'
    expect(cursorAdapter.classify(flat, '{"role":"user"}')).toMatchObject({ kind: 'session', reasonCode: 'transcript' })
    expect(cursorAdapter.classify(CURSOR_REL, '{"role":"user"}')).toMatchObject({ kind: 'session', reasonCode: 'transcript' })
    expect(cursorAdapter.expand!(flat, CURSOR_RAW)[0].content).toBe('**user:** hello\n\n**assistant:** hi')
    expect(cursorAdapter.expand!(CURSOR_REL, CURSOR_RAW)[0].content).toBe('**user:** hello\n\n**assistant:** hi')
  })

  it('omits created and updated on a transcript with no timestamp', () => {
    const u = cursorAdapter.expand!(CURSOR_REL, CURSOR_RAW)[0]
    expect('created' in u).toBe(false)
  })
})
