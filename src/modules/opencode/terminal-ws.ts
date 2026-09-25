// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The terminal socket (/api/v1/opencode/terminal/:id). The right to use it
// (manage OpenCode, permissions.ts) is asked when the socket opens and again
// for as long as it stays open: before every frame the client sends, on a
// periodic sweep while any terminal is attached, and on demand
// (`revalidate`, which the module runs when auth reports a user's role or
// status changed). A terminal whose user may no longer use it ends: each of
// its sockets gets the `forbidden` error frame and close 1008, and the PTY is
// destroyed — no frame reaches it after the refusal.

import type { Logger } from 'pino'
import { z } from 'zod'
import type { BusSubscription, EyasBus } from '@core/types'
import { USER_ACCESS_CHANGED } from '@modules/auth/events.js'
import type { PtyManager, PtyOutputSink } from './pty-manager.js'
import { encodeServerFrame, parseClientFrame } from './terminal-protocol.js'

/**
 * How often the open terminals are re-checked while nobody types: a role or
 * status changed by any writer (not only the auth routes) ends a terminal
 * within this, even one that only streams output.
 */
export const TERMINAL_REVALIDATE_MS = 15_000

export interface TerminalWsSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

export interface TerminalWsHandler {
  onOpen(ws: TerminalWsSocket, sessionId: string, userId: string): void
  onMessage(ws: TerminalWsSocket, sessionId: string, raw: string | Buffer): void
  onClose(ws: TerminalWsSocket, sessionId: string): void
  /**
   * Asks the right again for the open terminals — one user's, or everyone's —
   * and ends each one whose user may no longer use it. Returns how many
   * terminals ended.
   */
  revalidate(userId?: string): number
  /** Stops the periodic re-check (module stop). */
  dispose(): void
}

interface BoundSocket {
  sessionId: string
  userId: string
  sink: PtyOutputSink
  /** Set when the terminal is ended for a lost right: the sink goes silent. */
  revoked: boolean
}

export function createTerminalWsHandler(deps: {
  pty: PtyManager
  logger: Logger
  /**
   * Whether the user may use a terminal now (manage OpenCode, permissions.ts).
   * The upgrade already asked (ws-server.ts); asked again here when the
   * socket opens, so a socket that reaches onOpen by any other way still
   * attaches to nothing, and again while it stays open.
   */
  mayUseTerminal: (userId: string) => boolean
  /** The periodic re-check interval in ms; 0 turns the sweep off (tests). */
  revalidateMs?: number
}): TerminalWsHandler {
  const sinks = new Map<TerminalWsSocket, BoundSocket>()
  const revalidateMs = deps.revalidateMs ?? TERMINAL_REVALIDATE_MS
  let sweeper: ReturnType<typeof setInterval> | null = null

  function refuse(ws: TerminalWsSocket): void {
    try {
      ws.send(encodeServerFrame({ type: 'error', code: 'forbidden', message: 'Forbidden: cannot manage OpenCode' }))
    } catch { /* already gone */ }
    try { ws.close(1008, 'forbidden') } catch { /* already closing */ }
  }

  function stopSweepIfIdle(): void {
    if (sweeper && sinks.size === 0) {
      clearInterval(sweeper)
      sweeper = null
    }
  }

  function startSweep(): void {
    if (sweeper || revalidateMs <= 0) return
    sweeper = setInterval(() => {
      try { revalidate() } catch (err) {
        deps.logger.warn({ err }, 'OpenCode terminal re-check failed')
      }
    }, revalidateMs)
    if (typeof sweeper === 'object' && 'unref' in sweeper) sweeper.unref()
  }

  /**
   * Ends a terminal for a lost right: every socket attached to it is refused
   * (forbidden frame, close 1008) and the PTY is destroyed.
   */
  function endTerminal(sessionId: string, userId: string): void {
    deps.logger.warn({ sessionId, userId }, 'OpenCode terminal ended: the user may no longer manage OpenCode')
    for (const [ws, bound] of sinks) {
      if (bound.sessionId !== sessionId) continue
      bound.revoked = true
      sinks.delete(ws)
      refuse(ws)
    }
    try {
      deps.pty.destroy(sessionId)
    } catch (err) {
      deps.logger.warn({ err, sessionId }, 'OpenCode PTY destroy failed')
    }
    stopSweepIfIdle()
  }

  /** Whether the user may still use the terminal; a throwing check denies. */
  function allowed(userId: string): boolean {
    try {
      return deps.mayUseTerminal(userId) === true
    } catch {
      return false
    }
  }

  function revalidate(userId?: string): number {
    const verdicts = new Map<string, boolean>()
    const ended = new Set<string>()
    for (const bound of [...sinks.values()]) {
      if (userId !== undefined && bound.userId !== userId) continue
      if (ended.has(bound.sessionId)) continue
      let ok = verdicts.get(bound.userId)
      if (ok === undefined) {
        ok = allowed(bound.userId)
        verdicts.set(bound.userId, ok)
      }
      if (ok) continue
      ended.add(bound.sessionId)
      endTerminal(bound.sessionId, bound.userId)
    }
    return ended.size
  }

  return {
    onOpen(ws, sessionId, userId) {
      if (!allowed(userId)) {
        deps.logger.warn({ sessionId, userId }, 'OpenCode terminal socket refused: the user may not manage OpenCode')
        refuse(ws)
        return
      }
      const rec = deps.pty.get(sessionId)
      if (!rec || rec.userId !== userId) {
        ws.send(encodeServerFrame({ type: 'error', message: 'PTY session not found' }))
        try { ws.close(1008, 'session not found') } catch { /* already closing */ }
        return
      }
      const bound: BoundSocket = {
        sessionId,
        userId,
        revoked: false,
        sink: {
          send(_id, data) {
            if (bound.revoked) return
            ws.send(encodeServerFrame({ type: 'output', data }))
          },
          closed(_id, exitCode) {
            if (bound.revoked) return
            ws.send(encodeServerFrame({ type: 'exit', code: exitCode }))
            try { ws.close(1000, 'pty exited') } catch { /* gone */ }
          },
        },
      }
      deps.pty.attach(sessionId, bound.sink)
      sinks.set(ws, bound)
      startSweep()
      ws.send(encodeServerFrame({
        type: 'ready',
        sessionId,
        pid: rec.pid,
        cols: rec.cols,
        rows: rec.rows,
      }))
    },

    onMessage(ws, sessionId, raw) {
      const bound = sinks.get(ws)
      if (!bound || bound.sessionId !== sessionId) return
      // Every frame asks the right again (role and status read fresh): a
      // user demoted, suspended or archived while attached gets no further
      // keystroke, resize or ping through — the terminal ends here.
      if (!allowed(bound.userId)) {
        endTerminal(bound.sessionId, bound.userId)
        return
      }
      const frame = parseClientFrame(raw)
      if (!frame) return
      try {
        if (frame.type === 'input') deps.pty.write(sessionId, frame.data)
        else if (frame.type === 'resize') deps.pty.resize(sessionId, frame.cols, frame.rows)
        else if (frame.type === 'ping') ws.send(encodeServerFrame({ type: 'pong' }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        deps.logger.warn({ err, sessionId }, 'OpenCode PTY frame failed')
        ws.send(encodeServerFrame({ type: 'error', message }))
      }
    },

    onClose(ws, sessionId) {
      const bound = sinks.get(ws)
      sinks.delete(ws)
      stopSweepIfIdle()
      if (!bound) return
      deps.pty.detach(bound.sessionId === sessionId ? sessionId : bound.sessionId, bound.sink)
    },

    revalidate,

    dispose() {
      if (sweeper) clearInterval(sweeper)
      sweeper = null
    },
  }
}

/** The auth module's role/status-change event, as far as the terminals read it. */
const accessChangedSchema = z.object({ targetId: z.string().min(1) })

/**
 * Ends a user's open terminals as soon as auth reports that their role or
 * status changed (USER_ACCESS_CHANGED: a role change, a suspension, an
 * archive), if they may no longer use them. The bus is the only link: auth
 * knows nothing about terminals.
 */
export function endTerminalsOnAccessChange(deps: {
  bus: Pick<EyasBus, 'on'>
  handler: Pick<TerminalWsHandler, 'revalidate'>
  logger: Logger
}): BusSubscription {
  return deps.bus.on(USER_ACCESS_CHANGED, async (data) => {
    const parsed = accessChangedSchema.safeParse(data)
    if (!parsed.success) return
    const ended = deps.handler.revalidate(parsed.data.targetId)
    if (ended > 0) {
      deps.logger.info({ userId: parsed.data.targetId, ended }, 'OpenCode terminals ended after a role or status change')
    }
  })
}
