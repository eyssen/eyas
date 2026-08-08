// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mapAcpToolCall,
  chooseAcpOption,
  createAcpServerHandler,
  ACP_UNMAPPED_TOOL,
  type AcpCanUseTool,
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

describe('chooseAcpOption', () => {
  const opts = [
    { optionId: 'always', kind: 'allow_always' },
    { optionId: 'once', kind: 'allow_once' },
    { optionId: 'no', kind: 'reject_once' },
  ]

  it('allow prefers allow_once over allow_always (EYAS must keep evaluating every call)', () => {
    expect(chooseAcpOption(opts, 'allow')).toEqual({ outcome: 'selected', optionId: 'once' })
  })

  it('allow falls back to allow_always, then name regex', () => {
    expect(chooseAcpOption([{ optionId: 'always', kind: 'allow_always' }], 'allow')).toEqual({ outcome: 'selected', optionId: 'always' })
    expect(chooseAcpOption([{ optionId: 'x', name: 'Approve once' }], 'allow')).toEqual({ outcome: 'selected', optionId: 'x' })
  })

  it('deny prefers reject_once, then reject regex, else cancelled', () => {
    expect(chooseAcpOption(opts, 'deny')).toEqual({ outcome: 'selected', optionId: 'no' })
    expect(chooseAcpOption([{ optionId: 'r', name: 'Reject' }], 'deny')).toEqual({ outcome: 'selected', optionId: 'r' })
    expect(chooseAcpOption([{ optionId: 'always', kind: 'allow_always' }], 'deny')).toEqual({ outcome: 'cancelled' })
  })

  it('returns cancelled for an empty option list', () => {
    expect(chooseAcpOption([], 'allow')).toEqual({ outcome: 'cancelled' })
  })
})

function makeHandler(canUseTool?: AcpCanUseTool) {
  const respond = vi.fn()
  const respondError = vi.fn()
  const handle = createAcpServerHandler({ canUseTool, respond, respondError })
  return { handle, respond, respondError }
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
  it('allows via allow_once when the gate allows', async () => {
    const { handle, respond } = makeHandler(allowAll)
    const handled = await handle('session/request_permission', 1, permParams)
    expect(handled).toBe(true)
    expect(respond).toHaveBeenCalledWith(1, { outcome: { outcome: 'selected', optionId: 'ok-once' } })
  })

  it('rejects when the gate denies', async () => {
    const { handle, respond } = makeHandler(denyAll)
    await handle('session/request_permission', 2, permParams)
    expect(respond).toHaveBeenCalledWith(2, { outcome: { outcome: 'selected', optionId: 'no' } })
  })

  it('fail-closed: no gate wired → never selects an allow option', async () => {
    const { handle, respond } = makeHandler(undefined)
    await handle('session/request_permission', 3, permParams)
    expect(respond).toHaveBeenCalledWith(3, { outcome: { outcome: 'selected', optionId: 'no' } })
  })

  it('passes the mapped tool name and rawInput to the gate', async () => {
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { handle } = makeHandler(canUseTool)
    await handle('session/request_permission', 4, permParams)
    // input carries the raw ACP kind/title under `_acp` for judge context —
    // it must never influence the tool name (asserted separately above).
    expect(canUseTool).toHaveBeenCalledWith('Bash', expect.objectContaining({ command: 'ls' }))
  })
})

describe('createAcpServerHandler — fs requests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyas-acp-gov-'))

  it('fs/read_text_file: gated as Read, returns content when allowed', async () => {
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'line1\nline2\n', 'utf8')
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { handle, respond } = makeHandler(canUseTool)
    await handle('fs/read_text_file', 5, { path: file })
    expect(canUseTool).toHaveBeenCalledWith('Read', { path: file })
    expect(respond).toHaveBeenCalledWith(5, { content: 'line1\nline2\n' })
  })

  it('fs/read_text_file: denied by the gate → error, no content', async () => {
    const file = join(dir, 'b.txt')
    writeFileSync(file, 'secret', 'utf8')
    const { handle, respond, respondError } = makeHandler(denyAll)
    await handle('fs/read_text_file', 6, { path: file })
    expect(respond).not.toHaveBeenCalled()
    expect(respondError).toHaveBeenCalledWith(6, expect.stringContaining('denied'))
  })

  it('fs/write_text_file: gated as Write, writes when allowed', async () => {
    const file = join(dir, 'out.txt')
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { handle, respond } = makeHandler(canUseTool)
    await handle('fs/write_text_file', 7, { path: file, content: 'hello' })
    expect(canUseTool).toHaveBeenCalledWith('Write', { path: file, content: 'hello' })
    expect(readFileSync(file, 'utf8')).toBe('hello')
    expect(respond).toHaveBeenCalledWith(7, {})
  })

  it('fs/write_text_file: denied → nothing written', async () => {
    const file = join(dir, 'blocked.txt')
    const { handle, respondError } = makeHandler(denyAll)
    await handle('fs/write_text_file', 8, { path: file, content: 'nope' })
    expect(existsSync(file)).toBe(false)
    expect(respondError).toHaveBeenCalledWith(8, expect.stringContaining('denied'))
  })

  it('fail-closed: fs requests without a gate are refused', async () => {
    const file = join(dir, 'nogate.txt')
    const { handle, respondError } = makeHandler(undefined)
    await handle('fs/write_text_file', 9, { path: file, content: 'x' })
    expect(existsSync(file)).toBe(false)
    expect(respondError).toHaveBeenCalledWith(9, expect.any(String))
  })

  it('returns false for methods it does not handle', async () => {
    const { handle } = makeHandler(allowAll)
    expect(await handle('session/update', null, {})).toBe(false)
  })
})
