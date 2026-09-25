// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The terminal socket (/api/v1/opencode/terminal/:id) attaches only for a
// user who may manage OpenCode now — asked again when the socket opens, with
// the role read fresh from the users table — and only to that user's own PTY.
// The right is asked again for as long as the socket stays open: before every
// client frame, on the periodic sweep, and when auth reports a role or status
// change on the bus; a terminal that lost it ends (forbidden, 1008, PTY gone).

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createTerminalWsHandler, endTerminalsOnAccessChange, type TerminalWsSocket } from '@modules/opencode/terminal-ws'
import { USER_ACCESS_CHANGED } from '@modules/auth/events'
import { createLocalBus } from '@core/bus/local-bus'
import type { PtyOutputSink } from '@modules/opencode/pty-manager'
import { activeRoleOf, createTerminalAccess, OPENCODE_PERMISSIONS, OPENCODE_SUBJECT } from '@modules/opencode/permissions'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import type { RoleId } from '@modules/permissions/types'
import type { PtyManager } from '@modules/opencode/pty-manager'
import type { PtySessionRecord } from '@modules/opencode/types'

const testDb = createTestDb('opencode-terminal-ws')
let db: ReturnType<typeof testDb.open>

beforeEach(() => {
  db = testDb.open()
})
afterEach(() => testDb.cleanup())

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never

function user(id: string, role: RoleId, status = 'active'): void {
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO users (id, username, display_name, role, status, created_at, updated_at)
    VALUES (${id}, ${id}, ${id}, ${role}, ${status}, ${now}, ${now})`)
}

/** The terminal right exactly as the module wires it (index.ts onStart). */
function terminalAccess() {
  const registry = createPermissionRegistry()
  registry.registerSubject(OPENCODE_SUBJECT, OPENCODE_PERMISSIONS)
  return createTerminalAccess({
    roleOf: activeRoleOf(db),
    abilityFor: (role) => buildAbilityForRole(role as RoleId, registry),
  })
}

function ptyWith(records: PtySessionRecord[]) {
  const attach = vi.fn()
  const pty = {
    get: (id: string) => records.find((r) => r.id === id),
    attach,
    detach: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  } as unknown as PtyManager
  return { pty, attach }
}

function session(id: string, userId: string): PtySessionRecord {
  return { id, userId, conversationId: 'c1', kind: 'tui', cwd: '/w', cols: 80, rows: 24, pid: 7, state: 'running', createdAt: 0, lastActivityAt: 0 }
}

function socket() {
  const sent: Array<Record<string, unknown>> = []
  const close: Mock<(code?: number, reason?: string) => void> = vi.fn()
  const ws: TerminalWsSocket & { close: typeof close } = {
    send: (data: string) => { sent.push(JSON.parse(data) as Record<string, unknown>) },
    close,
  }
  return { ws, sent }
}

describe('OpenCode terminal socket — manage OpenCode, own session', () => {
  it('(−) a `user` cannot attach, not even to a terminal of their own: a forbidden frame, close 1008, nothing attached', () => {
    user('u1', 'user')
    const { pty, attach } = ptyWith([session('s1', 'u1')])
    const handler = createTerminalWsHandler({ pty, logger: silent, mayUseTerminal: terminalAccess() })
    const { ws, sent } = socket()
    handler.onOpen(ws, 's1', 'u1')
    expect(sent).toEqual([{ type: 'error', code: 'forbidden', message: 'Forbidden: cannot manage OpenCode' }])
    expect(ws.close).toHaveBeenCalledWith(1008, 'forbidden')
    expect(attach).not.toHaveBeenCalled()
    // Input on a refused socket reaches no PTY.
    handler.onMessage(ws, 's1', JSON.stringify({ type: 'input', data: 'id\r' }))
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('(−) the agent role and a guest cannot attach; a suspended or archived admin and an unknown user cannot either', () => {
    user('a1', 'agent')
    user('g1', 'guest')
    user('adm-s', 'admin', 'suspended')
    user('adm-x', 'admin', 'archived')
    const records = ['a1', 'g1', 'adm-s', 'adm-x', 'ghost'].map((id) => session(`s-${id}`, id))
    const { pty, attach } = ptyWith(records)
    const handler = createTerminalWsHandler({ pty, logger: silent, mayUseTerminal: terminalAccess() })
    for (const id of ['a1', 'g1', 'adm-s', 'adm-x', 'ghost']) {
      const { ws, sent } = socket()
      handler.onOpen(ws, `s-${id}`, id)
      expect(sent[0], id).toMatchObject({ type: 'error', code: 'forbidden' })
      expect(ws.close, id).toHaveBeenCalledWith(1008, 'forbidden')
    }
    expect(attach).not.toHaveBeenCalled()
  })

  it('(+) the owner and an admin attach to their own terminal; another user\'s session is not found', () => {
    user('own', 'owner')
    user('adm', 'admin')
    const { pty, attach } = ptyWith([session('s-own', 'own'), session('s-adm', 'adm')])
    const handler = createTerminalWsHandler({ pty, logger: silent, mayUseTerminal: terminalAccess() })
    for (const [id, sid] of [['own', 's-own'], ['adm', 's-adm']] as const) {
      const { ws, sent } = socket()
      handler.onOpen(ws, sid, id)
      expect(sent, id).toEqual([{ type: 'ready', sessionId: sid, pid: 7, cols: 80, rows: 24 }])
      expect(ws.close, id).not.toHaveBeenCalled()
    }
    expect(attach).toHaveBeenCalledTimes(2)
    // The admin's right does not reach the owner's terminal.
    const { ws, sent } = socket()
    handler.onOpen(ws, 's-own', 'adm')
    expect(sent).toEqual([{ type: 'error', message: 'PTY session not found' }])
    expect(ws.close).toHaveBeenCalledWith(1008, 'session not found')
    expect(attach).toHaveBeenCalledTimes(2)
  })

  it('(−) a role changed after the terminal opened counts at the next attach (read fresh, never cached)', () => {
    user('adm', 'admin')
    const { pty, attach } = ptyWith([session('s1', 'adm')])
    const handler = createTerminalWsHandler({ pty, logger: silent, mayUseTerminal: terminalAccess() })
    handler.onOpen(socket().ws, 's1', 'adm')
    expect(attach).toHaveBeenCalledTimes(1)
    db.run(sql`UPDATE users SET role = 'user' WHERE id = 'adm'`)
    const { ws, sent } = socket()
    handler.onOpen(ws, 's1', 'adm')
    expect(sent[0]).toMatchObject({ type: 'error', code: 'forbidden' })
    expect(attach).toHaveBeenCalledTimes(1)
  })

  it('(−) a lookup that throws denies (fail closed)', () => {
    const mayUse = createTerminalAccess({
      roleOf: () => { throw new Error('db gone') },
      abilityFor: () => ({ can: () => true }),
    })
    expect(mayUse('anyone')).toBe(false)
    expect(mayUse('')).toBe(false)
  })
})

const FORBIDDEN = { type: 'error', code: 'forbidden', message: 'Forbidden: cannot manage OpenCode' }

describe('OpenCode terminal socket — the right is asked again while the socket stays open', () => {
  /** An admin attached to their own terminal (the sweep off unless asked). */
  function attachedAdmin(id = 'adm', opts: { revalidateMs?: number } = {}) {
    user(id, 'admin')
    const { pty, attach } = ptyWith([session(`s-${id}`, id)])
    const handler = createTerminalWsHandler({
      pty,
      logger: silent,
      mayUseTerminal: terminalAccess(),
      revalidateMs: opts.revalidateMs ?? 0,
    })
    const { ws, sent } = socket()
    handler.onOpen(ws, `s-${id}`, id)
    expect(sent).toEqual([{ type: 'ready', sessionId: `s-${id}`, pid: 7, cols: 80, rows: 24 }])
    sent.length = 0
    return { pty, attach, handler, ws, sent, sessionId: `s-${id}` }
  }

  it('(−) an admin demoted to `user` while attached: the next keystroke never reaches the PTY; forbidden frame, close 1008, the PTY is ended', () => {
    const { pty, handler, ws, sent, sessionId } = attachedAdmin()
    // Positive control: while the right holds, input goes through.
    handler.onMessage(ws, sessionId, JSON.stringify({ type: 'input', data: 'ls\r' }))
    expect(pty.write).toHaveBeenCalledWith(sessionId, 'ls\r')

    db.run(sql`UPDATE users SET role = 'user' WHERE id = 'adm'`)
    handler.onMessage(ws, sessionId, JSON.stringify({ type: 'input', data: 'id\r' }))
    expect(pty.write).toHaveBeenCalledTimes(1)
    expect(pty.write).not.toHaveBeenCalledWith(sessionId, 'id\r')
    expect(sent).toEqual([FORBIDDEN])
    expect(ws.close).toHaveBeenCalledWith(1008, 'forbidden')
    expect(pty.destroy).toHaveBeenCalledWith(sessionId)

    // Frames still in flight after the refusal reach nothing, and the close
    // that follows detaches nothing twice.
    handler.onMessage(ws, sessionId, JSON.stringify({ type: 'input', data: 'whoami\r' }))
    handler.onMessage(ws, sessionId, JSON.stringify({ type: 'resize', cols: 100, rows: 30 }))
    handler.onMessage(ws, sessionId, 'raw text is input too')
    expect(pty.write).toHaveBeenCalledTimes(1)
    expect(pty.resize).not.toHaveBeenCalled()
    handler.onClose(ws, sessionId)
    expect(pty.detach).not.toHaveBeenCalled()
    expect(pty.destroy).toHaveBeenCalledTimes(1)
  })

  it('(−) an admin suspended or archived while attached: an input, a resize and a ping are each refused', () => {
    const frames = {
      input: JSON.stringify({ type: 'input', data: 'id\r' }),
      raw: 'id\r',
      resize: JSON.stringify({ type: 'resize', cols: 100, rows: 30 }),
      ping: JSON.stringify({ type: 'ping' }),
    }
    for (const status of ['suspended', 'archived']) {
      for (const [kind, frame] of Object.entries(frames)) {
        const id = `adm-${status}-${kind}`
        const { pty, handler, ws, sent, sessionId } = attachedAdmin(id)
        db.run(sql`UPDATE users SET status = ${status} WHERE id = ${id}`)
        handler.onMessage(ws, sessionId, frame)
        expect(pty.write, id).not.toHaveBeenCalled()
        expect(pty.resize, id).not.toHaveBeenCalled()
        expect(sent, id).toEqual([FORBIDDEN]) // no pong either
        expect(ws.close, id).toHaveBeenCalledWith(1008, 'forbidden')
        expect(pty.destroy, id).toHaveBeenCalledWith(sessionId)
      }
    }
  })

  it('(+) someone who keeps the right keeps working: every frame is checked, nothing ends', () => {
    const { pty, handler, ws, sent, sessionId } = attachedAdmin()
    handler.onMessage(ws, sessionId, JSON.stringify({ type: 'input', data: 'a' }))
    handler.onMessage(ws, sessionId, JSON.stringify({ type: 'input', data: 'b' }))
    handler.onMessage(ws, sessionId, JSON.stringify({ type: 'resize', cols: 100, rows: 30 }))
    handler.onMessage(ws, sessionId, JSON.stringify({ type: 'ping' }))
    expect(pty.write).toHaveBeenCalledTimes(2)
    expect(pty.resize).toHaveBeenCalledWith(sessionId, 100, 30)
    expect(sent).toEqual([{ type: 'pong' }])
    expect(ws.close).not.toHaveBeenCalled()
    expect(pty.destroy).not.toHaveBeenCalled()
    // A promotion is not a loss: an admin made owner keeps the terminal.
    db.run(sql`UPDATE users SET role = 'owner' WHERE id = 'adm'`)
    handler.onMessage(ws, sessionId, JSON.stringify({ type: 'input', data: 'c' }))
    expect(pty.write).toHaveBeenCalledTimes(3)
  })

  it('(−) a check that throws ends the terminal (fail closed)', () => {
    user('adm', 'admin')
    const { pty } = ptyWith([session('s1', 'adm')])
    let broken = false
    const handler = createTerminalWsHandler({
      pty,
      logger: silent,
      mayUseTerminal: (id) => { if (broken) throw new Error('db gone'); return id === 'adm' },
      revalidateMs: 0,
    })
    const { ws, sent } = socket()
    handler.onOpen(ws, 's1', 'adm')
    broken = true
    handler.onMessage(ws, 's1', JSON.stringify({ type: 'input', data: 'id\r' }))
    expect(pty.write).not.toHaveBeenCalled()
    expect(sent.at(-1)).toEqual(FORBIDDEN)
    expect(pty.destroy).toHaveBeenCalledWith('s1')
  })

  it('(−) revalidate(user) ends only that user\'s terminals that lost the right, on every socket attached (two tabs), and the ended sockets go silent', () => {
    user('adm1', 'admin')
    user('adm2', 'admin')
    const { pty, attach } = ptyWith([session('s1', 'adm1'), session('s2', 'adm2')])
    const handler = createTerminalWsHandler({ pty, logger: silent, mayUseTerminal: terminalAccess(), revalidateMs: 0 })
    const tab1 = socket()
    const tab2 = socket()
    const other = socket()
    handler.onOpen(tab1.ws, 's1', 'adm1')
    handler.onOpen(tab2.ws, 's1', 'adm1')
    handler.onOpen(other.ws, 's2', 'adm2')
    for (const s of [tab1, tab2, other]) s.sent.length = 0

    db.run(sql`UPDATE users SET role = 'user' WHERE id = 'adm1'`)
    expect(handler.revalidate('adm2')).toBe(0)
    expect(pty.destroy).not.toHaveBeenCalled()
    expect(handler.revalidate('adm1')).toBe(1)
    for (const tab of [tab1, tab2]) {
      expect(tab.sent).toEqual([FORBIDDEN])
      expect(tab.ws.close).toHaveBeenCalledWith(1008, 'forbidden')
    }
    expect(pty.destroy).toHaveBeenCalledTimes(1)
    expect(pty.destroy).toHaveBeenCalledWith('s1')
    expect(other.sent).toEqual([])
    expect(other.ws.close).not.toHaveBeenCalled()

    // The PTY's last output and its exit, flushed while it is destroyed,
    // reach no ended socket.
    for (const [, sink] of attach.mock.calls.slice(0, 2) as Array<[string, PtyOutputSink]>) {
      sink.send('s1', 'secret output')
      sink.closed('s1', 0)
    }
    expect(tab1.sent).toEqual([FORBIDDEN])
    expect(tab2.sent).toEqual([FORBIDDEN])

    // Everyone at once: adm2 still may, nothing more ends.
    expect(handler.revalidate()).toBe(0)
    expect(other.ws.close).not.toHaveBeenCalled()
  })

  it('(−) the periodic sweep ends an idle terminal that lost the right with no frame from the client, and stops when no terminal is left', () => {
    vi.useFakeTimers()
    try {
      const { pty, handler, ws, sent, sessionId } = attachedAdmin('adm', { revalidateMs: 1_000 })
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(1_000)
      expect(pty.destroy).not.toHaveBeenCalled() // still an admin: kept
      db.run(sql`UPDATE users SET status = 'suspended' WHERE id = 'adm'`)
      vi.advanceTimersByTime(1_000)
      expect(sent).toEqual([FORBIDDEN])
      expect(ws.close).toHaveBeenCalledWith(1008, 'forbidden')
      expect(pty.destroy).toHaveBeenCalledWith(sessionId)
      expect(vi.getTimerCount()).toBe(0)
      handler.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('(+) the sweep also stops when the last socket closes normally, and dispose stops it', () => {
    vi.useFakeTimers()
    try {
      const { handler, ws, sessionId, pty } = attachedAdmin('adm', { revalidateMs: 1_000 })
      expect(vi.getTimerCount()).toBe(1)
      handler.onClose(ws, sessionId)
      expect(pty.detach).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)

      const again = socket()
      handler.onOpen(again.ws, sessionId, 'adm')
      expect(vi.getTimerCount()).toBe(1)
      handler.dispose()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('(−) auth\'s role or status change on the bus ends that user\'s terminal at once; a malformed event and an unsubscribed listener do nothing', async () => {
    user('adm', 'admin')
    user('adm2', 'admin')
    const { pty } = ptyWith([session('s-adm', 'adm'), session('s-adm2', 'adm2')])
    const handler = createTerminalWsHandler({ pty, logger: silent, mayUseTerminal: terminalAccess(), revalidateMs: 0 })
    const mine = socket()
    const other = socket()
    handler.onOpen(mine.ws, 's-adm', 'adm')
    handler.onOpen(other.ws, 's-adm2', 'adm2')
    mine.sent.length = 0
    other.sent.length = 0
    const bus = createLocalBus()
    const subscription = endTerminalsOnAccessChange({ bus, handler, logger: silent })

    bus.emit(USER_ACCESS_CHANGED, { userId: 'own', targetId: 'adm', role: 'admin' })
    await Promise.resolve()
    expect(pty.destroy).not.toHaveBeenCalled() // reported, but the right holds

    db.run(sql`UPDATE users SET role = 'user' WHERE id = 'adm'`)
    bus.emit(USER_ACCESS_CHANGED, { userId: 'own' }) // no targetId: ignored
    bus.emit(USER_ACCESS_CHANGED, { userId: 'own', targetId: 'adm2', role: 'admin' }) // someone else: not adm's terminal
    await Promise.resolve()
    expect(pty.destroy).not.toHaveBeenCalled()

    bus.emit(USER_ACCESS_CHANGED, { userId: 'own', targetId: 'adm', role: 'user' })
    await Promise.resolve()
    expect(mine.sent).toEqual([FORBIDDEN])
    expect(mine.ws.close).toHaveBeenCalledWith(1008, 'forbidden')
    expect(pty.destroy).toHaveBeenCalledWith('s-adm')
    expect(other.sent).toEqual([])

    // After unsubscribing, the bus no longer reaches the terminals (the
    // per-frame check and the sweep still would).
    subscription.unsubscribe()
    db.run(sql`UPDATE users SET role = 'user' WHERE id = 'adm2'`)
    bus.emit(USER_ACCESS_CHANGED, { userId: 'own', targetId: 'adm2', role: 'user' })
    await Promise.resolve()
    expect(pty.destroy).toHaveBeenCalledTimes(1)
    expect(other.ws.close).not.toHaveBeenCalled()
  })
})
