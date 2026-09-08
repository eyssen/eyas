// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { generateId } from '@shared/crypto.js'
import type { Logger } from 'pino'
import { clipText, stripAnsi } from './ansi.js'
import { resolveSessionCwd } from './path-guard.js'
import type {
  CreatePtySessionInput,
  PtyFactory,
  PtyHandle,
  PtyKind,
  PtySessionRecord,
  PtySpawnOptions,
} from './types.js'

const IDLE_MS = 30 * 60_000
const FLUSH_MS = 16
const MEMORY_FLUSH_MS = 8_000
const MEMORY_FLUSH_CHARS = 4_000
const MEMORY_CLIP = 12_000

export interface PtyOutputSink {
  send(sessionId: string, data: string): void
  closed(sessionId: string, exitCode: number): void
}

export interface PtyMemoryCapture {
  (input: { sessionId: string; conversationId: string; text: string; kind: PtyKind }): void
}

export interface PtyManager {
  create(input: CreatePtySessionInput, spawnOpts: { file: string; args: string[]; env: Record<string, string> }): PtySessionRecord
  get(id: string): PtySessionRecord | undefined
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  attach(id: string, sink: PtyOutputSink): void
  detach(id: string, sink: PtyOutputSink): void
  destroy(id: string, signal?: NodeJS.Signals): void
  destroyAll(): void
  listForUser(userId: string): PtySessionRecord[]
  count(): number
}

interface LiveSession {
  record: PtySessionRecord
  handle: PtyHandle
  sinks: Set<PtyOutputSink>
  outBuf: string
  memBuf: string
  flushTimer: ReturnType<typeof setTimeout> | null
  memTimer: ReturnType<typeof setTimeout> | null
}

export function createPtyManager(deps: {
  spawn: PtyFactory
  logger: Logger
  maxSessions: number
  fallbackCwd: string
  capture?: PtyMemoryCapture
  now?: () => number
}): PtyManager {
  const sessions = new Map<string, LiveSession>()
  const now = deps.now ?? (() => Date.now())

  function flushOut(live: LiveSession): void {
    if (live.flushTimer) {
      clearTimeout(live.flushTimer)
      live.flushTimer = null
    }
    if (!live.outBuf) return
    const payload = live.outBuf
    live.outBuf = ''
    for (const sink of live.sinks) sink.send(live.record.id, payload)
  }

  function flushMem(live: LiveSession): void {
    if (live.memTimer) {
      clearTimeout(live.memTimer)
      live.memTimer = null
    }
    if (!live.memBuf || !deps.capture) return
    const text = clipText(stripAnsi(live.memBuf), MEMORY_CLIP)
    live.memBuf = ''
    if (!text.trim()) return
    deps.capture({
      sessionId: live.record.id,
      conversationId: live.record.conversationId,
      text,
      kind: live.record.kind,
    })
  }

  function scheduleOut(live: LiveSession): void {
    if (live.flushTimer) return
    live.flushTimer = setTimeout(() => flushOut(live), FLUSH_MS)
  }

  function scheduleMem(live: LiveSession): void {
    if (live.memBuf.length >= MEMORY_FLUSH_CHARS) {
      flushMem(live)
      return
    }
    if (live.memTimer) return
    live.memTimer = setTimeout(() => flushMem(live), MEMORY_FLUSH_MS)
  }

  function drop(id: string, exitCode: number): void {
    const live = sessions.get(id)
    if (!live) return
    flushOut(live)
    flushMem(live)
    live.record.state = 'exited'
    for (const sink of live.sinks) sink.closed(id, exitCode)
    live.sinks.clear()
    try { live.handle.dispose() } catch { /* already dead */ }
    sessions.delete(id)
  }

  function sweepIdle(): void {
    const t = now()
    for (const [id, live] of sessions) {
      if (t - live.record.lastActivityAt > IDLE_MS) {
        deps.logger.info({ sessionId: id }, 'OpenCode PTY idle timeout')
        drop(id, 0)
      }
    }
  }
  const sweeper = setInterval(sweepIdle, 60_000)
  if (typeof sweeper === 'object' && 'unref' in sweeper) sweeper.unref()

  return {
    create(input, spawnOpts) {
      if (sessions.size >= deps.maxSessions) {
        throw new Error(`PTY session limit reached (${deps.maxSessions})`)
      }
      const cwd = resolveSessionCwd({
        requested: input.cwd,
        workingDirectories: input.workingDirectories,
        fallback: deps.fallbackCwd,
      })
      const cols = input.cols ?? 120
      const rows = input.rows ?? 32
      const opts: PtySpawnOptions = {
        file: spawnOpts.file,
        args: spawnOpts.args,
        cwd,
        env: spawnOpts.env,
        cols,
        rows,
      }
      const handle = deps.spawn(opts)
      const id = generateId()
      const record: PtySessionRecord = {
        id,
        userId: input.userId,
        conversationId: input.conversationId,
        kind: input.kind,
        cwd,
        cols,
        rows,
        pid: handle.pid,
        state: 'ready',
        createdAt: now(),
        lastActivityAt: now(),
      }
      const live: LiveSession = {
        record,
        handle,
        sinks: new Set(),
        outBuf: '',
        memBuf: '',
        flushTimer: null,
        memTimer: null,
      }
      handle.onData((chunk) => {
        live.record.lastActivityAt = now()
        live.record.state = 'running'
        const text = Buffer.from(chunk).toString('utf8')
        live.outBuf += text
        live.memBuf += text
        scheduleOut(live)
        scheduleMem(live)
      })
      handle.onExit((info) => {
        drop(id, info.exitCode)
      })
      sessions.set(id, live)
      return { ...record }
    },

    get(id) {
      const live = sessions.get(id)
      return live ? { ...live.record } : undefined
    },

    write(id, data) {
      const live = sessions.get(id)
      if (!live) throw new Error('PTY session not found')
      live.record.lastActivityAt = now()
      live.handle.write(data)
    },

    resize(id, cols, rows) {
      const live = sessions.get(id)
      if (!live) throw new Error('PTY session not found')
      live.record.cols = cols
      live.record.rows = rows
      live.record.lastActivityAt = now()
      live.handle.resize(cols, rows)
    },

    attach(id, sink) {
      const live = sessions.get(id)
      if (!live) throw new Error('PTY session not found')
      live.sinks.add(sink)
    },

    detach(id, sink) {
      const live = sessions.get(id)
      if (!live) return
      live.sinks.delete(sink)
      if (live.sinks.size === 0) {
        deps.logger.debug({ sessionId: id }, 'OpenCode PTY last client disconnected — destroying')
        drop(id, 0)
      }
    },

    destroy(id, signal = 'SIGTERM') {
      const live = sessions.get(id)
      if (!live) return
      try { live.handle.kill(signal) } catch { /* gone */ }
      drop(id, 0)
    },

    destroyAll() {
      for (const id of [...sessions.keys()]) {
        const live = sessions.get(id)
        if (!live) continue
        try { live.handle.kill('SIGTERM') } catch { /* gone */ }
        drop(id, 0)
      }
    },

    listForUser(userId) {
      return [...sessions.values()].filter((s) => s.record.userId === userId).map((s) => ({ ...s.record }))
    },

    count() {
      return sessions.size
    },
  }
}
