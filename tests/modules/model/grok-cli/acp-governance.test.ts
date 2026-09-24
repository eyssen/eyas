// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A6 (with B3 folded in) — the ACP governance owner: allow_once only, one
// symlink-resolving jail for the files the CLI reads and writes through EYAS,
// the memory-path policy after it, and exactly one gate decision per
// operation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mapAcpToolCall,
  chooseAcpOption,
  createAcpCanUseTool,
  createAcpServerHandler,
  resolveAcpRoots,
  sliceTextLines,
  acpMemoryPathCheckFrom,
  ACP_UNMAPPED_TOOL,
  type AcpCanUseTool,
  type AcpServerHandlerDeps,
} from '@modules/model/submodules/grok-cli/acp-governance.js'

const allowAll: AcpCanUseTool = async () => ({ behavior: 'allow' })
const denyAll: AcpCanUseTool = async () => ({ behavior: 'deny', message: 'gate denied' })

describe('mapAcpToolCall', () => {
  it('maps ACP tool kinds onto the canonical gate vocabulary', () => {
    const execResult = mapAcpToolCall({ kind: 'execute', rawInput: { command: 'ls' } })
    expect(execResult.name).toBe('Bash')
    expect(execResult.input).toMatchObject({ command: 'ls' })
    expect(execResult.mapped).toBe(true)
    expect(mapAcpToolCall({ kind: 'edit' }).name).toBe('Write')
    expect(mapAcpToolCall({ kind: 'read' }).name).toBe('Read')
    expect(mapAcpToolCall({ kind: 'fetch' }).name).toBe('WebFetch')
    expect(mapAcpToolCall({ kind: 'search' }).name).toBe('Grep')
    expect(mapAcpToolCall({ kind: 'move' }).name).toBe('Write')
  })

  it('maps delete to Bash (red tier) — fail-closed for destructive calls', () => {
    expect(mapAcpToolCall({ kind: 'delete' }).name).toBe('Bash')
  })

  it('never uses the agent-controlled title or unmapped kind as the gate name', () => {
    expect(mapAcpToolCall({ kind: 'other', title: 'Custom Tool' }).name).toBe(ACP_UNMAPPED_TOOL)
    expect(mapAcpToolCall({ title: 'My Tool' }).name).toBe(ACP_UNMAPPED_TOOL)
    expect(mapAcpToolCall({}).name).toBe(ACP_UNMAPPED_TOOL)
  })

  it('a title spoofing a green-tier tool name cannot self-classify the call', () => {
    const { name, mapped } = mapAcpToolCall({ kind: 'other', title: 'search_memory' })
    expect(name).toBe(ACP_UNMAPPED_TOOL)
    expect(mapped).toBe(false)
  })
})

describe('chooseAcpOption — allow_once only, by kind only', () => {
  // The grok 1.0.40 edit prompt (permission-requests fixture): allow_always first.
  const editOptions = [
    { optionId: 'allow-edits-session', name: 'Yes, allow all edits during this session', kind: 'allow_always' },
    { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' },
    { optionId: 'reject-once', name: 'No, and tell Grok what to do differently', kind: 'reject_once' },
  ]

  it('an allow picks the allow_once option (positive)', () => {
    expect(chooseAcpOption(editOptions, 'allow')).toEqual({ outcome: 'selected', optionId: 'allow-once' })
  })

  it('an allow with only allow_always on offer is cancelled, never a standing grant (negative)', () => {
    expect(chooseAcpOption([{ optionId: 'always', kind: 'allow_always' }], 'allow')).toEqual({ outcome: 'cancelled' })
  })

  it('an option is never picked by its name (negative)', () => {
    expect(chooseAcpOption([{ optionId: 'x', name: 'Approve' }], 'allow')).toEqual({ outcome: 'cancelled' })
    expect(chooseAcpOption([{ optionId: 'y', name: 'Enable always-approve mode' }], 'allow')).toEqual({ outcome: 'cancelled' })
    expect(chooseAcpOption([{ optionId: 'r', name: 'Reject' }], 'deny')).toEqual({ outcome: 'cancelled' })
  })

  it('a deny picks reject_once; with no reject_once it is cancelled', () => {
    expect(chooseAcpOption(editOptions, 'deny')).toEqual({ outcome: 'selected', optionId: 'reject-once' })
    expect(chooseAcpOption([{ optionId: 'ra', kind: 'reject_always' }], 'deny')).toEqual({ outcome: 'cancelled' })
    expect(chooseAcpOption([{ optionId: 'always', kind: 'allow_always' }], 'deny')).toEqual({ outcome: 'cancelled' })
  })

  it('returns cancelled for an empty option list', () => {
    expect(chooseAcpOption([], 'allow')).toEqual({ outcome: 'cancelled' })
    expect(chooseAcpOption([], 'deny')).toEqual({ outcome: 'cancelled' })
  })
})

describe('sliceTextLines', () => {
  const text = 'l1\nl2\nl3\nl4\nl5'
  it('line is the 1-based first line, limit the line count (positive)', () => {
    expect(sliceTextLines(text, 3, 2)).toBe('l3\nl4')
    expect(sliceTextLines(text, 1, 1)).toBe('l1')
    expect(sliceTextLines(text, 4)).toBe('l4\nl5')
    expect(sliceTextLines(text, null, 2)).toBe('l1\nl2')
  })
  it('without line or limit the whole text comes back; past the end is empty', () => {
    expect(sliceTextLines(text)).toBe(text)
    expect(sliceTextLines(text, 9, 2)).toBe('')
    expect(sliceTextLines(text, 2, 0)).toBe('')
  })
})

let root: string
let outside: string

beforeEach(() => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-gov-')))
  root = join(base, 'conversation')
  outside = join(base, 'elsewhere')
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
})

afterEach(() => {
  rmSync(join(root, '..'), { recursive: true, force: true })
})

function makeHandler(canUseTool?: AcpCanUseTool, extra: Partial<AcpServerHandlerDeps> = {}) {
  const respond = vi.fn()
  const respondError = vi.fn()
  const onDecision = vi.fn()
  const onFsServed = vi.fn()
  const warn = vi.fn()
  const handle = createAcpServerHandler({
    canUseTool,
    respond,
    respondError,
    roots: [root],
    onDecision,
    onFsServed,
    logger: { warn },
    ...extra,
  })
  return { handle, respond, respondError, onDecision, onFsServed, warn }
}

const permParams = {
  toolCall: { toolCallId: 't1', kind: 'execute', title: 'Run command', rawInput: { command: 'ls' } },
  options: [
    { optionId: 'ok-always', kind: 'allow_always' },
    { optionId: 'ok-once', kind: 'allow_once' },
    { optionId: 'no', kind: 'reject_once' },
  ],
}

describe('createAcpServerHandler — session/request_permission', () => {
  it('allows via allow_once when the gate allows, and reports the decision before answering', async () => {
    const { handle, respond, onDecision } = makeHandler(allowAll)
    expect(await handle('session/request_permission', 1, permParams)).toBe(true)
    expect(respond).toHaveBeenCalledWith(1, { outcome: { outcome: 'selected', optionId: 'ok-once' } })
    expect(onDecision).toHaveBeenCalledWith({ toolCallId: 't1', behavior: 'allow' })
    expect(onDecision.mock.invocationCallOrder[0]).toBeLessThan(respond.mock.invocationCallOrder[0])
  })

  it('rejects when the gate denies', async () => {
    const { handle, respond, onDecision } = makeHandler(denyAll)
    await handle('session/request_permission', 2, permParams)
    expect(respond).toHaveBeenCalledWith(2, { outcome: { outcome: 'selected', optionId: 'no' } })
    // G3: the refusal carries its outcome and reason, for the tool row.
    expect(onDecision).toHaveBeenCalledWith({ toolCallId: 't1', behavior: 'deny', toolName: 'Bash', outcome: 'denied', reason: 'gate denied' })
  })

  it('a refusal waiting on a human reports approval_required with the queued approval (G3)', async () => {
    const waiting: AcpCanUseTool = async () => ({ behavior: 'deny', message: 'approval required (shell_exec): red', outcome: 'approval_required', approvalId: 42 })
    const { handle, respond, onDecision } = makeHandler(waiting)
    await handle('session/request_permission', 12, permParams)
    expect(respond).toHaveBeenCalledWith(12, { outcome: { outcome: 'selected', optionId: 'no' } })
    expect(onDecision).toHaveBeenCalledWith({
      toolCallId: 't1',
      behavior: 'deny',
      toolName: 'Bash',
      outcome: 'approval_required',
      reason: 'approval required (shell_exec): red',
      approvalId: 42,
    })
  })

  it('an allow reports no refusal fields (negative)', async () => {
    const { handle, onDecision } = makeHandler(allowAll)
    await handle('session/request_permission', 13, permParams)
    expect(onDecision.mock.calls[0][0]).toEqual({ toolCallId: 't1', behavior: 'allow' })
  })

  it('fail-closed: no gate wired → never selects an allow option', async () => {
    const { handle, respond } = makeHandler(undefined)
    await handle('session/request_permission', 3, permParams)
    expect(respond).toHaveBeenCalledWith(3, { outcome: { outcome: 'selected', optionId: 'no' } })
  })

  it('a gate allow with no allow_once on offer is answered cancelled and logged (negative)', async () => {
    const { handle, respond, onDecision, warn } = makeHandler(allowAll)
    await handle('session/request_permission', 4, { ...permParams, options: [{ optionId: 'ok-always', kind: 'allow_always' }] })
    expect(respond).toHaveBeenCalledWith(4, { outcome: { outcome: 'cancelled' } })
    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 't1', behavior: 'cancelled', outcome: 'denied' }))
    expect(warn).toHaveBeenCalled()
  })

  it('passes the mapped tool name and rawInput to the gate', async () => {
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { handle } = makeHandler(canUseTool)
    await handle('session/request_permission', 5, permParams)
    // …and which call it decides (the ACP toolCallId).
    expect(canUseTool).toHaveBeenCalledWith('Bash', expect.objectContaining({ command: 'ls' }), { toolCallId: 't1' })
  })

  it('an isolated completion rejects every permission request without asking the gate', async () => {
    const canUseTool = vi.fn(allowAll)
    const { handle, respond, onDecision } = makeHandler(canUseTool, { isolated: true })
    await handle('session/request_permission', 6, permParams)
    expect(canUseTool).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith(6, { outcome: { outcome: 'selected', optionId: 'no' } })
    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 't1', behavior: 'deny', outcome: 'denied', reason: 'isolated completion: no tools' }))
  })

  it('a malformed request is answered cancelled without asking the gate (negative)', async () => {
    const canUseTool = vi.fn(allowAll)
    const { handle, respond } = makeHandler(canUseTool)
    await handle('session/request_permission', 7, { toolCall: 'nope', options: [] })
    expect(canUseTool).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith(7, { outcome: { outcome: 'cancelled' } })
  })
})

describe('createAcpServerHandler — the fs jail', () => {
  it('serves an in-root read after one gate decision (uncovered read), with the real path', async () => {
    const file = join(root, 'a.txt')
    writeFileSync(file, 'line1\nline2\n', 'utf8')
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { handle, respond, onFsServed } = makeHandler(canUseTool)
    await handle('fs/read_text_file', 10, { path: file })
    expect(canUseTool).toHaveBeenCalledTimes(1)
    expect(canUseTool).toHaveBeenCalledWith('Read', { path: file })
    expect(respond).toHaveBeenCalledWith(10, { content: 'line1\nline2\n' })
    expect(onFsServed).toHaveBeenCalledWith(file, 'read')
  })

  it('line=3, limit=2 returns exactly lines 3-4', async () => {
    const file = join(root, 'lines.txt')
    writeFileSync(file, 'one\ntwo\nthree\nfour\nfive\n', 'utf8')
    const { handle, respond } = makeHandler(allowAll)
    await handle('fs/read_text_file', 11, { path: file, line: 3, limit: 2 })
    expect(respond).toHaveBeenCalledWith(11, { content: 'three\nfour' })
  })

  it('a read outside the roots is refused before the gate and the file (negative)', async () => {
    const file = join(outside, 'secret.txt')
    writeFileSync(file, 'SECRET', 'utf8')
    const canUseTool = vi.fn(allowAll)
    const { handle, respond, respondError } = makeHandler(canUseTool)
    await handle('fs/read_text_file', 12, { path: file })
    expect(respond).not.toHaveBeenCalled()
    expect(canUseTool).not.toHaveBeenCalled()
    expect(respondError).toHaveBeenCalledWith(12, expect.stringContaining('escapes'))
  })

  it("a '../' escape is refused, absolute or relative (negative)", async () => {
    writeFileSync(join(outside, 'x.txt'), 'X', 'utf8')
    const { handle, respond, respondError } = makeHandler(allowAll)
    await handle('fs/read_text_file', 13, { path: join(root, '..', 'elsewhere', 'x.txt') })
    await handle('fs/read_text_file', 14, { path: '../elsewhere/x.txt' })
    expect(respond).not.toHaveBeenCalled()
    expect(respondError).toHaveBeenCalledTimes(2)
  })

  it('a symlink inside the root that points into a vault or a provider store is refused (negative)', async () => {
    const vault = join(outside, 'Vault')
    mkdirSync(join(vault, '.obsidian'), { recursive: true })
    writeFileSync(join(vault, 'note.md'), 'VAULT-NOTE', 'utf8')
    const claudeStore = join(outside, '.claude')
    mkdirSync(claudeStore, { recursive: true })
    writeFileSync(join(claudeStore, 'CLAUDE.md'), 'HOST-RULES', 'utf8')
    symlinkSync(vault, join(root, 'notes'))
    symlinkSync(join(claudeStore, 'CLAUDE.md'), join(root, 'CLAUDE.md'))
    const canUseTool = vi.fn(allowAll)
    const { handle, respond, respondError } = makeHandler(canUseTool)
    await handle('fs/read_text_file', 15, { path: join(root, 'notes', 'note.md') })
    await handle('fs/read_text_file', 16, { path: join(root, 'CLAUDE.md') })
    expect(respond).not.toHaveBeenCalled()
    expect(respondError).toHaveBeenCalledTimes(2)
    expect(canUseTool).not.toHaveBeenCalled()
  })

  it('a write of a new file under a symlinked folder that points outside is refused (negative)', async () => {
    symlinkSync(outside, join(root, 'out'))
    const canUseTool = vi.fn(allowAll)
    const { handle, respondError } = makeHandler(canUseTool)
    await handle('fs/write_text_file', 17, { path: join(root, 'out', 'new', 'planted.md'), content: 'x' })
    expect(existsSync(join(outside, 'new', 'planted.md'))).toBe(false)
    expect(canUseTool).not.toHaveBeenCalled()
    expect(respondError).toHaveBeenCalledWith(17, expect.stringContaining('denied'))
  })

  it('empty roots refuse every fs request (negative)', async () => {
    const file = join(root, 'a.txt')
    writeFileSync(file, 'A', 'utf8')
    const canUseTool = vi.fn(allowAll)
    const { handle, respond, respondError } = makeHandler(canUseTool, { roots: [] })
    await handle('fs/read_text_file', 18, { path: file })
    await handle('fs/write_text_file', 19, { path: join(root, 'b.txt'), content: 'B' })
    expect(respond).not.toHaveBeenCalled()
    expect(respondError).toHaveBeenCalledTimes(2)
    expect(existsSync(join(root, 'b.txt'))).toBe(false)
    expect(canUseTool).not.toHaveBeenCalled()
  })

  it('a protected path inside the roots is refused by the memory-path policy (negative)', async () => {
    const vault = join(root, 'vault')
    mkdirSync(join(vault, '.obsidian'), { recursive: true })
    writeFileSync(join(vault, 'note.md'), 'VAULT', 'utf8')
    const canUseTool = vi.fn(allowAll)
    const { handle, respond, respondError } = makeHandler(canUseTool)
    await handle('fs/read_text_file', 20, { path: join(vault, 'note.md') })
    expect(respond).not.toHaveBeenCalled()
    expect(canUseTool).not.toHaveBeenCalled()
    expect(respondError).toHaveBeenCalledWith(20, expect.stringContaining('memory outside EYAS'))
  })

  it('an injected memory-path check runs after the jail, and a throwing check denies', async () => {
    const file = join(root, 'a.txt')
    writeFileSync(file, 'A', 'utf8')
    const check = vi.fn(() => ({ reason: 'gate says no' }))
    const { handle, respondError } = makeHandler(allowAll, { checkMemoryPath: check })
    await handle('fs/read_text_file', 21, { path: file })
    expect(check).toHaveBeenCalledWith('Read', { path: file }, { workingDirectories: [root] })
    expect(respondError).toHaveBeenCalledWith(21, expect.stringContaining('gate says no'))

    const throwing = makeHandler(allowAll, { checkMemoryPath: () => { throw new Error('boom') } })
    await throwing.handle('fs/read_text_file', 22, { path: file })
    expect(throwing.respond).not.toHaveBeenCalled()
    expect(throwing.respondError).toHaveBeenCalledWith(22, expect.stringContaining('boom'))
  })

  it('an isolated completion refuses every fs request', async () => {
    const file = join(root, 'a.txt')
    writeFileSync(file, 'A', 'utf8')
    const canUseTool = vi.fn(allowAll)
    const { handle, respond, respondError } = makeHandler(canUseTool, { isolated: true })
    await handle('fs/read_text_file', 23, { path: file })
    await handle('fs/write_text_file', 24, { path: join(root, 'b.txt'), content: 'B' })
    expect(respond).not.toHaveBeenCalled()
    expect(respondError).toHaveBeenCalledTimes(2)
    expect(existsSync(join(root, 'b.txt'))).toBe(false)
    expect(canUseTool).not.toHaveBeenCalled()
  })

  it('a malformed fs request is refused (negative)', async () => {
    const { handle, respondError } = makeHandler(allowAll)
    await handle('fs/read_text_file', 25, { path: 42 })
    await handle('fs/write_text_file', 26, { path: join(root, 'x'), content: { not: 'text' } })
    expect(respondError).toHaveBeenCalledTimes(2)
  })

  it('fs/write_text_file: gated as Write when nobody asked, writes when allowed', async () => {
    const file = join(root, 'out.txt')
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { handle, respond } = makeHandler(canUseTool)
    await handle('fs/write_text_file', 27, { path: file, content: 'hello' })
    expect(canUseTool).toHaveBeenCalledWith('Write', { path: file, content: 'hello' })
    expect(readFileSync(file, 'utf8')).toBe('hello')
    expect(respond).toHaveBeenCalledWith(27, {})
  })

  it('fs/write_text_file: denied → nothing written', async () => {
    const file = join(root, 'blocked.txt')
    const { handle, respondError } = makeHandler(denyAll)
    await handle('fs/write_text_file', 28, { path: file, content: 'nope' })
    expect(existsSync(file)).toBe(false)
    expect(respondError).toHaveBeenCalledWith(28, expect.stringContaining('denied'))
  })

  it('fail-closed: fs requests without a gate are refused', async () => {
    const file = join(root, 'nogate.txt')
    const { handle, respondError } = makeHandler(undefined)
    await handle('fs/write_text_file', 29, { path: file, content: 'x' })
    expect(existsSync(file)).toBe(false)
    expect(respondError).toHaveBeenCalledWith(29, expect.any(String))
  })

  it('returns false for methods it does not handle', async () => {
    const { handle } = makeHandler(allowAll)
    expect(await handle('session/update', null, {})).toBe(false)
  })
})

describe('createAcpServerHandler — one gate decision per operation', () => {
  const readPermission = (path: string, extra: Record<string, unknown> = {}) => ({
    toolCall: { toolCallId: 'call_main_0', kind: 'read', title: `Read \`${path}\``, rawInput: { variant: 'ReadFile', target_file: path, offset: 2, limit: 2 }, ...extra },
    options: [{ optionId: 'allow-once', kind: 'allow_once' }, { optionId: 'reject-once', kind: 'reject_once' }],
  })

  it('an in-root read covered by the permission decision is served without a second gate call (positive)', async () => {
    const file = join(root, 'probe.txt')
    writeFileSync(file, 'a\nb\nc\n', 'utf8')
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { handle, respond } = makeHandler(canUseTool)
    await handle('session/request_permission', 30, readPermission(file))
    await handle('fs/read_text_file', 31, { path: file, line: 2, limit: 2 })
    expect(canUseTool).toHaveBeenCalledTimes(1)
    expect(respond).toHaveBeenLastCalledWith(31, { content: 'b\nc' })
  })

  it('coverage also comes from the tool call locations the session reported', async () => {
    const file = join(root, 'probe.txt')
    writeFileSync(file, 'x', 'utf8')
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { handle, respond } = makeHandler(canUseTool, { pathsForToolCall: (id) => (id === 'call_main_0' ? [file] : []) })
    await handle('session/request_permission', 32, {
      toolCall: { toolCallId: 'call_main_0', kind: 'read', title: 'Read' },
      options: [{ optionId: 'allow-once', kind: 'allow_once' }],
    })
    await handle('fs/read_text_file', 33, { path: file })
    expect(canUseTool).toHaveBeenCalledTimes(1)
    expect(respond).toHaveBeenLastCalledWith(33, { content: 'x' })
  })

  it('a write covered by the edit permission reads and writes without a second gate call', async () => {
    const file = join(root, 'spike-out.txt')
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { handle } = makeHandler(canUseTool)
    await handle('session/request_permission', 34, {
      toolCall: { toolCallId: 'call_main_4', kind: 'edit', title: 'Write', rawInput: { variant: 'Write', file_path: file, content: 'spike\n' } },
      options: [{ optionId: 'allow-edits-session', kind: 'allow_always' }, { optionId: 'allow-once', kind: 'allow_once' }],
    })
    await handle('fs/write_text_file', 35, { path: file, content: 'spike\n' })
    await handle('fs/read_text_file', 36, { path: file })
    expect(canUseTool).toHaveBeenCalledTimes(1)
    expect(readFileSync(file, 'utf8')).toBe('spike\n')
  })

  it('a read permission does not cover a write of the same path (the write is judged itself)', async () => {
    const file = join(root, 'probe.txt')
    writeFileSync(file, 'x', 'utf8')
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { handle } = makeHandler(canUseTool)
    await handle('session/request_permission', 37, readPermission(file))
    await handle('fs/write_text_file', 38, { path: file, content: 'y' })
    expect(canUseTool).toHaveBeenCalledTimes(2)
    expect(canUseTool).toHaveBeenLastCalledWith('Write', { path: file, content: 'y' })
  })

  it('a path the gate refused stays refused for the client fs, without asking again (negative)', async () => {
    const file = join(root, 'probe.txt')
    writeFileSync(file, 'x', 'utf8')
    const canUseTool = vi.fn(denyAll)
    const { handle, respond, respondError } = makeHandler(canUseTool)
    await handle('session/request_permission', 39, readPermission(file))
    await handle('fs/read_text_file', 40, { path: file })
    expect(canUseTool).toHaveBeenCalledTimes(1)
    expect(respond).not.toHaveBeenCalledWith(40, expect.anything())
    expect(respondError).toHaveBeenCalledWith(40, expect.stringContaining('refused'))
  })

  it('an uncovered in-root read calls the gate exactly once', async () => {
    const file = join(root, 'probe.txt')
    writeFileSync(file, 'x', 'utf8')
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { handle } = makeHandler(canUseTool)
    await handle('session/request_permission', 41, readPermission(join(root, 'other.txt')))
    await handle('fs/read_text_file', 42, { path: file })
    expect(canUseTool).toHaveBeenCalledTimes(2)
    expect(canUseTool).toHaveBeenLastCalledWith('Read', { path: file })
  })
})

describe('resolveAcpRoots', () => {
  const ctx = (checkFolder: (p: string) => { ok: true; path: string } | { ok: false; code: string }) =>
    ({ dataDir: '/nonexistent/data', root: '/nonexistent/workspaces', checkFolder })

  it('no folders: the session cwd alone', () => {
    expect(resolveAcpRoots({}, '/w/run', ctx((p) => ({ ok: true, path: p })))).toEqual(['/w/run'])
  })

  it('every valid folder, plus the cwd once (positive)', () => {
    const roots = resolveAcpRoots({ metadata: { workingDirectories: ['/w/a', '/w/b'] } }, '/w/a', ctx((p) => ({ ok: true, path: p })))
    expect(roots).toEqual(['/w/a', '/w/b'])
  })

  it('a folder the folder check refuses never becomes a root (negative)', () => {
    const roots = resolveAcpRoots(
      { metadata: { workingDirectories: ['/home/me', '/w/a'] } },
      '/w/a',
      ctx((p) => (p === '/home/me' ? { ok: false, code: 'home' } : { ok: true, path: p })),
    )
    expect(roots).toEqual(['/w/a'])
  })
})

describe('acpMemoryPathCheckFrom', () => {
  it('adapts the gate check: a deny becomes the reason, null or allow passes', async () => {
    const gate = vi.fn((_tool: string, input: Record<string, unknown>) =>
      String(input.path).includes('vault') ? { decision: 'deny', reason: 'Memory outside EYAS (Obsidian vault)' } : null)
    const check = acpMemoryPathCheckFrom(gate, { conversationId: 'c1' })!
    expect(await check('Read', { path: '/x/vault/a.md' }, { workingDirectories: ['/x'] })).toEqual({ reason: 'Memory outside EYAS (Obsidian vault)' })
    expect(await check('Read', { path: '/x/a.md' }, { workingDirectories: ['/x'] })).toBeNull()
    expect(gate).toHaveBeenCalledWith('Read', { path: '/x/a.md' }, { workingDirectories: ['/x'], conversationId: 'c1' })
    const allowing = acpMemoryPathCheckFrom(() => ({ decision: 'allow' }), {})!
    expect(await allowing('Read', { path: '/x' }, { workingDirectories: [] })).toBeNull()
  })

  it('no gate check: undefined (the handler then uses the path policy)', () => {
    expect(acpMemoryPathCheckFrom(undefined, {})).toBeUndefined()
  })
})

describe('G3 — refusal outcomes for the tool rows', () => {
  it('a client-fs operation the gate refuses is reported without a toolCallId, with its outcome', async () => {
    const file = join(root, 'probe.txt')
    writeFileSync(file, 'x', 'utf8')
    const waiting: AcpCanUseTool = async () => ({ behavior: 'deny', message: 'approval required (file_read): yellow', outcome: 'approval_required', approvalId: 7 })
    const { handle, respondError, onDecision } = makeHandler(waiting)
    await handle('fs/read_text_file', 50, { path: file })
    expect(respondError).toHaveBeenCalledWith(50, expect.stringContaining('approval required'))
    expect(onDecision).toHaveBeenCalledWith({ behavior: 'deny', toolName: 'Read', outcome: 'approval_required', reason: 'approval required (file_read): yellow', approvalId: 7 })
  })

  it('a jail refusal is not a gate decision: nothing is reported (negative)', async () => {
    const secret = join(outside, 'secret.txt')
    writeFileSync(secret, 'SECRET', 'utf8')
    const { handle, onDecision } = makeHandler(allowAll)
    await handle('fs/read_text_file', 51, { path: secret })
    expect(onDecision).not.toHaveBeenCalled()
  })
})

describe('createAcpCanUseTool — the shared permission bridge as the ACP gate', () => {
  const signal = new AbortController().signal
  const gate = (decision: 'allow' | 'deny' | 'escalate') => ({
    validateToolCall: vi.fn(() => ({ decision, reason: decision === 'deny' ? 'blocked' : 'needs a human', riskTier: 'red' })),
  })

  it('an escalation comes back as a refusal waiting on a human, with the queued approval id', async () => {
    const createApproval = vi.fn(() => 31)
    const canUseTool = createAcpCanUseTool({
      ...gate('escalate'),
      autonomy: { categoryForTool: () => 'shell_exec', resolve: () => ({ level: 1, locked: true, maxLevel: 3 }), createApproval },
      autonomous: false,
      ctx: { conversationId: 'c1' },
    }, signal)
    const decision = await canUseTool('Bash', { command: 'rm -rf x' }, { toolCallId: 'call_1' })
    expect(decision).toMatchObject({ behavior: 'deny', outcome: 'approval_required', approvalId: 31 })
    expect(createApproval).toHaveBeenCalledTimes(1)
  })

  it('a gate deny is a plain denial', async () => {
    const canUseTool = createAcpCanUseTool({ ...gate('deny'), autonomous: false, ctx: { conversationId: 'c1' } }, signal)
    const decision = await canUseTool('Bash', { command: 'ls' }, { toolCallId: 'call_2' })
    expect(decision).toMatchObject({ behavior: 'deny', outcome: 'denied' })
    expect(decision).not.toHaveProperty('approvalId')
  })

  it('a ledger hit on a resumed run is a skip', async () => {
    const { toolLedgerKey } = await import('@shared/arg-hash.js')
    const canUseTool = createAcpCanUseTool({
      ...gate('allow'),
      autonomous: false,
      ctx: { conversationId: 'c1' },
      ledger: new Set([toolLedgerKey('Bash', { command: 'deploy' })]),
    }, signal)
    expect(await canUseTool('Bash', { command: 'deploy' }, { toolCallId: 'call_3' })).toMatchObject({ behavior: 'deny', outcome: 'skipped' })
  })

  it('an allow carries no refusal fields, and concurrent calls never mix up their reports (negative)', async () => {
    let n = 0
    const canUseTool = createAcpCanUseTool({
      validateToolCall: vi.fn(async () => {
        const mine = n++
        await new Promise((r) => setTimeout(r, mine === 0 ? 10 : 0))
        return mine === 0 ? { decision: 'allow' as const, reason: 'ok', riskTier: 'green' } : { decision: 'deny' as const, reason: 'no', riskTier: 'red' }
      }),
      autonomous: false,
      ctx: { conversationId: 'c1' },
    }, signal)
    const [first, second] = await Promise.all([
      canUseTool('Read', { path: '/a' }, { toolCallId: 'same' }),
      canUseTool('Bash', { command: 'x' }, { toolCallId: 'same' }),
    ])
    expect(first).toEqual({ behavior: 'allow' })
    expect(second).toMatchObject({ behavior: 'deny', outcome: 'denied' })
  })
})

// K1 — Grok asks EYAS before every native search (ask mode). Its grep and
// list_dir reach the security gate's deterministic memory-path check through
// the shared permission bridge, which judges what the search can reach below
// its folder, not only the folder.
describe('K1 — Grok grep / list_dir rooted above a protected place', () => {
  async function searchSetup() {
    const { createPathPolicy, workAreaRootsOf } = await import('@shared/memory-sovereignty/path-policy.js')
    const { createDeterministicGate } = await import('@modules/security-gate/deterministic-gate.js')
    const { DEFAULT_CONFIG } = await import('@modules/security-gate/types.js')
    const base = join(root, '..')
    const home = join(base, 'home')
    mkdirSync(join(home, '.claude', 'projects', 'x', 'memory'), { recursive: true })
    writeFileSync(join(home, '.claude', 'projects', 'x', 'memory', 'MEMORY.md'), 'private\n')
    writeFileSync(join(root, 'notes.md'), 'workspace\n')
    const dataDir = join(base, 'eyas-data')
    const policy = createPathPolicy({
      homeDir: home,
      env: {},
      dataDir,
      workspacesRoot: join(dataDir, 'workspaces'),
      workAreaRoots: workAreaRootsOf({ dataDir, workspacesDir: join(dataDir, 'workspaces') }),
      providerHomes: [join(dataDir, 'cli-homes')],
    })
    const det = createDeterministicGate(DEFAULT_CONFIG, { getPathPolicy: () => policy })
    const canUseTool = createAcpCanUseTool({
      validateToolCall: (name, input, ctx) => det.check(name, input, ctx as never),
      autonomous: false,
      ctx: { conversationId: 'c1', workingDirectories: [root] },
    }, new AbortController().signal)
    return { home, ...makeHandler(canUseTool) }
  }

  const request = (toolCallId: string, kind: string, rawInput: Record<string, unknown>) => ({
    toolCall: { toolCallId, kind, title: 'x', rawInput },
    options: [{ optionId: 'allow-once', kind: 'allow_once' }, { optionId: 'reject-once', kind: 'reject_once' }],
  })

  it('(+) a grep of the home and a list_dir of the home are rejected with the coded search reason', async () => {
    const { home, handle, respond, onDecision } = await searchSetup()
    await handle('session/request_permission', 1, request('call_0', 'search', { variant: 'Grep', pattern: 'private', path: home, glob: null, '-i': false }))
    await handle('session/request_permission', 2, request('call_1', 'other', { variant: 'ListDir', target_directory: home }))
    expect(respond).toHaveBeenNthCalledWith(1, 1, { outcome: { outcome: 'selected', optionId: 'reject-once' } })
    expect(respond).toHaveBeenNthCalledWith(2, 2, { outcome: { outcome: 'selected', optionId: 'reject-once' } })
    const reasons = onDecision.mock.calls.map(([info]) => info.reason)
    for (const reason of reasons) expect(reason).toMatch(/Search too broad \[memory-path:search-scope:foreign-memory\]/)
  })

  it('(−) a grep of the conversation folder is allowed; its list_dir is not refused by the memory-path policy', async () => {
    const { handle, respond, onDecision } = await searchSetup()
    await handle('session/request_permission', 1, request('call_0', 'search', { variant: 'Grep', pattern: 'workspace', path: root, glob: '*.md' }))
    await handle('session/request_permission', 2, request('call_1', 'other', { variant: 'ListDir', target_directory: root }))
    expect(respond).toHaveBeenNthCalledWith(1, 1, { outcome: { outcome: 'selected', optionId: 'allow-once' } })
    // list_dir has ACP kind 'other' (unmapped): the gate escalates it to a
    // human for that reason alone — never as a search that reaches too far.
    const listDir = onDecision.mock.calls.map(([info]) => info).find((info) => info.toolCallId === 'call_1')
    expect(listDir?.reason ?? '').not.toMatch(/memory-path:search-scope/)
  })
})

// K3 (R1A-15) — the agent's tool list bounds the CLI's own tools: a native
// call needing a capability the turn's scope does not grant is refused before
// the gate is asked (tools/cli-exposure.ts).
describe('K3 — the tool scope refuses native tools the agent\'s list does not grant', () => {
  const READ_ONLY = new Set(['read'] as const)
  const options = permParams.options
  const ask = (toolCall: Record<string, unknown>) => ({ toolCall, options })

  it('(−) execute and delete kinds are refused without the shell, and the gate is never asked', async () => {
    const canUseTool = vi.fn(allowAll)
    const { handle, respond, onDecision } = makeHandler(canUseTool, { nativeCapabilities: READ_ONLY })
    await handle('session/request_permission', 1, ask({ toolCallId: 'x1', kind: 'execute', title: 'Execute `ls`', rawInput: { command: 'ls' } }))
    await handle('session/request_permission', 2, ask({ toolCallId: 'x2', kind: 'delete', title: 'Delete a.txt' }))
    expect(canUseTool).not.toHaveBeenCalled()
    expect(respond).toHaveBeenNthCalledWith(1, 1, { outcome: { outcome: 'selected', optionId: 'no' } })
    expect(respond).toHaveBeenNthCalledWith(2, 2, { outcome: { outcome: 'selected', optionId: 'no' } })
    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'x1', behavior: 'deny', toolName: 'Bash', outcome: 'denied',
      reason: expect.stringContaining('its tool list has none of run_command'),
    }))
  })

  it('(−) edit and move kinds are refused without write_file/edit_file', async () => {
    const canUseTool = vi.fn(allowAll)
    const { handle, respond, onDecision } = makeHandler(canUseTool, { nativeCapabilities: READ_ONLY })
    await handle('session/request_permission', 3, ask({ toolCallId: 'e1', kind: 'edit', title: 'Edit notes.md' }))
    await handle('session/request_permission', 4, ask({ toolCallId: 'm1', kind: 'move', title: 'Move a to b' }))
    expect(canUseTool).not.toHaveBeenCalled()
    expect(respond.mock.calls.map((c) => c[1])).toEqual([
      { outcome: { outcome: 'selected', optionId: 'no' } },
      { outcome: { outcome: 'selected', optionId: 'no' } },
    ])
    expect(onDecision.mock.calls[0][0].reason).toContain('write_file, edit_file')
  })

  it('(−) a fetch, and grok\'s web_search whatever its kind, are refused without a web tool', async () => {
    const canUseTool = vi.fn(allowAll)
    const { handle, respond } = makeHandler(canUseTool, { nativeCapabilities: new Set(['read', 'write', 'shell'] as const) })
    await handle('session/request_permission', 5, ask({ toolCallId: 'f1', kind: 'fetch', title: 'Fetch https://example.com' }))
    await handle('session/request_permission', 6, ask({
      toolCallId: 'w1', kind: 'search', title: 'eyas docs',
      _meta: { 'x.ai/tool': { version: 1, name: 'web_search', kind: 'search', read_only: true } },
    }))
    expect(canUseTool).not.toHaveBeenCalled()
    expect(respond.mock.calls.map((c) => c[1].outcome.optionId)).toEqual(['no', 'no'])
  })

  it('(+) reads, searches and grok\'s list_dir / search_tool still go to the gate on a read-only list', async () => {
    const canUseTool = vi.fn(allowAll)
    const { handle, respond } = makeHandler(canUseTool, { nativeCapabilities: READ_ONLY })
    await handle('session/request_permission', 7, ask({ toolCallId: 'r1', kind: 'read', title: 'Read a.txt', rawInput: { target_file: join(root, 'a.txt') } }))
    await handle('session/request_permission', 8, ask({ toolCallId: 's1', kind: 'search', title: 'PROBE', _meta: { 'x.ai/tool': { name: 'grep' } } }))
    await handle('session/request_permission', 9, ask({ toolCallId: 'l1', kind: 'other', title: 'List files', _meta: { 'x.ai/tool': { name: 'list_dir' } } }))
    await handle('session/request_permission', 10, ask({ toolCallId: 'st1', kind: 'other', title: 'search_tool', _meta: { 'x.ai/tool': { name: 'search_tool' } } }))
    expect(canUseTool).toHaveBeenCalledTimes(4)
    expect(respond.mock.calls.map((c) => c[1].outcome.optionId)).toEqual(['ok-once', 'ok-once', 'ok-once', 'ok-once'])
  })

  it('(+) a list with write and shell tools keeps edit and execute: the gate decides them', async () => {
    const canUseTool = vi.fn(allowAll)
    const { handle, respond } = makeHandler(canUseTool, { nativeCapabilities: new Set(['read', 'write', 'shell'] as const) })
    await handle('session/request_permission', 11, ask({ toolCallId: 'x3', kind: 'execute', rawInput: { command: 'ls' } }))
    await handle('session/request_permission', 12, ask({ toolCallId: 'e3', kind: 'edit' }))
    expect(canUseTool).toHaveBeenCalledWith('Bash', expect.objectContaining({ command: 'ls' }), { toolCallId: 'x3' })
    expect(canUseTool).toHaveBeenCalledWith('Write', expect.anything(), { toolCallId: 'e3' })
    expect(respond.mock.calls.map((c) => c[1].outcome.optionId)).toEqual(['ok-once', 'ok-once'])
  })

  it('(+) no nativeCapabilities (no tool list): every kind goes to the gate as before', async () => {
    const canUseTool = vi.fn(allowAll)
    const { handle } = makeHandler(canUseTool)
    await handle('session/request_permission', 13, ask({ toolCallId: 'x4', kind: 'execute' }))
    await handle('session/request_permission', 14, ask({ toolCallId: 'f4', kind: 'fetch' }))
    expect(canUseTool).toHaveBeenCalledTimes(2)
  })

  it('(−) kimi: a request with no kind is refused while write or shell is withheld, naming it by its title', async () => {
    const canUseTool = vi.fn(allowAll)
    const { handle, respond, onDecision } = makeHandler(canUseTool, { nativeCapabilities: new Set(['read', 'shell'] as const) })
    await handle('session/request_permission', 15, ask({ toolCallId: 'k1', title: 'WriteFile notes.md' }))
    expect(canUseTool).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith(15, { outcome: { outcome: 'selected', optionId: 'no' } })
    expect(onDecision.mock.calls[0][0].reason).toMatch(/^'WriteFile notes\.md' is not in this agent's toolset: .*did not say what this tool does/)
  })

  it('(+) kimi: the kind the session gave the call earlier decides it; with write and shell granted, a kindless request reaches the gate', async () => {
    const canUseTool = vi.fn(allowAll)
    const describeToolCall = vi.fn((id: string) => (id === 'k2' ? { kind: 'read' } : {}))
    const readOnly = makeHandler(canUseTool, { nativeCapabilities: READ_ONLY, describeToolCall })
    await readOnly.handle('session/request_permission', 16, ask({ toolCallId: 'k2', title: 'ReadFile a.txt' }))
    expect(describeToolCall).toHaveBeenCalledWith('k2')
    expect(readOnly.respond).toHaveBeenCalledWith(16, { outcome: { outcome: 'selected', optionId: 'ok-once' } })

    const full = makeHandler(canUseTool, { nativeCapabilities: new Set(['read', 'write', 'shell'] as const) })
    await full.handle('session/request_permission', 17, ask({ toolCallId: 'k3', title: 'Shell' }))
    expect(full.respond).toHaveBeenCalledWith(17, { outcome: { outcome: 'selected', optionId: 'ok-once' } })
    expect(canUseTool).toHaveBeenCalledTimes(2)
  })

  it('(−) the session\'s earlier word refuses a kindless request of a withheld capability (kind execute from tool_call)', async () => {
    const canUseTool = vi.fn(allowAll)
    const { handle, respond } = makeHandler(canUseTool, {
      nativeCapabilities: new Set(['read', 'write'] as const),
      describeToolCall: () => ({ name: 'run_terminal_command', kind: 'execute' }),
    })
    await handle('session/request_permission', 18, ask({ toolCallId: 'k4', title: 'Execute `ls`' }))
    expect(canUseTool).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith(18, { outcome: { outcome: 'selected', optionId: 'no' } })
  })

  it('(−) a client-fs write is refused without the write capability, before the gate; a read is still served', async () => {
    const canUseTool = vi.fn(allowAll)
    const { handle, respond, respondError, onDecision } = makeHandler(canUseTool, { nativeCapabilities: READ_ONLY })
    const target = join(root, 'new.txt')
    await handle('fs/write_text_file', 20, { path: target, content: 'x' })
    expect(respondError).toHaveBeenCalledWith(20, expect.stringContaining("'Write' is not in this agent's toolset"))
    expect(existsSync(target)).toBe(false)
    expect(canUseTool).not.toHaveBeenCalled()
    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'deny', toolName: 'Write', outcome: 'denied' }))

    writeFileSync(join(root, 'a.txt'), 'hello')
    await handle('fs/read_text_file', 21, { path: join(root, 'a.txt') })
    expect(respond).toHaveBeenCalledWith(21, { content: 'hello' })
  })

  it('(+) with the write capability, a client-fs write goes on to the gate and is written', async () => {
    const canUseTool = vi.fn(allowAll)
    const { handle, respond } = makeHandler(canUseTool, { nativeCapabilities: new Set(['read', 'write'] as const) })
    const target = join(root, 'ok.txt')
    await handle('fs/write_text_file', 22, { path: target, content: 'written' })
    expect(respond).toHaveBeenCalledWith(22, {})
    expect(readFileSync(target, 'utf8')).toBe('written')
  })

  it('(−) a malformed _meta is no name, never a failed request', async () => {
    const canUseTool = vi.fn(allowAll)
    const { handle, respond } = makeHandler(canUseTool, { nativeCapabilities: READ_ONLY })
    await handle('session/request_permission', 23, ask({ toolCallId: 'r9', kind: 'read', _meta: { 'x.ai/tool': 'garbage' } }))
    expect(respond).toHaveBeenCalledWith(23, { outcome: { outcome: 'selected', optionId: 'ok-once' } })
  })
})
