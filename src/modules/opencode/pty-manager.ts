// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { generateId } from '@shared/crypto.js'
import type { Logger } from 'pino'
import { clipText, stripAnsi } from './ansi.js'
import { resolveSessionCwd } from './path-guard.js'
import { OPENCODE_KEY_FD, OPENCODE_KEY_FD_ENV, type PluginTokenRegistry } from './plugin-tokens.js'
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
  (input: { sessionId: string; userId: string; conversationId: string; text: string; kind: PtyKind }): void
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
  /** The OpenCode TUI's memory-plugin key, revoked when the PTY goes. */
  tokenId: string | null
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
  /**
   * Records terminal output. Called only while `captureEnabled` says so
   * (memory.l0.captureToolResults) and only for a session opened for a
   * conversation.
   */
  capture?: PtyMemoryCapture
  /** The capture switch, read per flush. Absent: nothing is captured. */
  captureEnabled?: () => boolean
  /**
   * Mints the memory-plugin key of each OpenCode TUI (kind 'tui'), handed to
   * the PTY factory for the child's fd 3 (never its environment) and revoked
   * when that PTY exits or is destroyed. A shell PTY never gets one.
   */
  pluginTokens?: Pick<PluginTokenRegistry, 'mint' | 'revoke'>
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

  /** Whether this session's output may be recorded now. */
  function capturing(live: LiveSession): boolean {
    if (!deps.capture || !live.record.conversationId) return false
    try {
      return deps.captureEnabled?.() === true
    } catch {
      return false
    }
  }

  function flushMem(live: LiveSession): void {
    if (live.memTimer) {
      clearTimeout(live.memTimer)
      live.memTimer = null
    }
    if (!live.memBuf) return
    const raw = live.memBuf
    live.memBuf = ''
    if (!deps.capture || !capturing(live)) return
    const text = clipText(stripAnsi(raw), MEMORY_CLIP)
    if (!text.trim()) return
    try {
      deps.capture({
        sessionId: live.record.id,
        userId: live.record.userId,
        conversationId: live.record.conversationId,
        text,
        kind: live.record.kind,
      })
    } catch (err) {
      deps.logger.debug({ err, sessionId: live.record.id }, 'OpenCode PTY capture failed (ignored)')
    }
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
    if (live.tokenId) deps.pluginTokens?.revoke(live.tokenId)
    live.tokenId = null
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
      const id = generateId()
      // Only an OpenCode TUI gets a memory-plugin key, its own, on fd 3; the
      // environment carries only the marker that says so, and no PTY
      // inherits a marker from the caller's environment.
      const env = { ...spawnOpts.env }
      delete env[OPENCODE_KEY_FD_ENV]
      const minted = input.kind === 'tui' && deps.pluginTokens ? deps.pluginTokens.mint('pty', id) : null
      if (minted) env[OPENCODE_KEY_FD_ENV] = String(OPENCODE_KEY_FD)
      const opts: PtySpawnOptions = {
        file: spawnOpts.file,
        args: spawnOpts.args,
        cwd,
        env,
        cols,
        rows,
        ...(minted ? { pluginKey: minted.key } : {}),
      }
      let handle: PtyHandle
      try {
        handle = deps.spawn(opts)
      } catch (err) {
        if (minted) deps.pluginTokens?.revoke(minted.tokenId)
        throw err
      }
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
        tokenId: minted?.tokenId ?? null,
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
        scheduleOut(live)
        // Buffered for memory only while it could be recorded.
        if (capturing(live)) {
          live.memBuf += text
          scheduleMem(live)
        }
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
