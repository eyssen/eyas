// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { PtyManager, PtyOutputSink } from './pty-manager.js'
import { encodeServerFrame, parseClientFrame } from './terminal-protocol.js'

export interface TerminalWsSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

export interface TerminalWsHandler {
  onOpen(ws: TerminalWsSocket, sessionId: string, userId: string): void
  onMessage(ws: TerminalWsSocket, sessionId: string, raw: string | Buffer): void
  onClose(ws: TerminalWsSocket, sessionId: string): void
}

export function createTerminalWsHandler(deps: {
  pty: PtyManager
  logger: Logger
}): TerminalWsHandler {
  const sinks = new Map<TerminalWsSocket, { sessionId: string; sink: PtyOutputSink }>()

  return {
    onOpen(ws, sessionId, userId) {
      const rec = deps.pty.get(sessionId)
      if (!rec || rec.userId !== userId) {
        ws.send(encodeServerFrame({ type: 'error', message: 'PTY session not found' }))
        try { ws.close(1008, 'session not found') } catch { /* already closing */ }
        return
      }
      const sink: PtyOutputSink = {
        send(_id, data) {
          ws.send(encodeServerFrame({ type: 'output', data }))
        },
        closed(_id, exitCode) {
          ws.send(encodeServerFrame({ type: 'exit', code: exitCode }))
          try { ws.close(1000, 'pty exited') } catch { /* gone */ }
        },
      }
      deps.pty.attach(sessionId, sink)
      sinks.set(ws, { sessionId, sink })
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
      if (!bound) return
      deps.pty.detach(bound.sessionId === sessionId ? sessionId : bound.sessionId, bound.sink)
    },
  }
}
