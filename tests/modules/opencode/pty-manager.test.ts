// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { afterEach, describe, it, expect, vi } from 'vitest'
import { createPtyManager } from '@modules/opencode/pty-manager'
import { createPluginTokenRegistry, makeSessionProof, OPENCODE_KEY_FD_ENV } from '@modules/opencode/plugin-tokens'
import type { PtyHandle, PtySpawnOptions } from '@modules/opencode/types'
import pino from 'pino'

/** A PTY whose output and exit the test drives. */
function drivenFactory() {
  const spawned: Array<{ opts: PtySpawnOptions; data: (s: string) => void; exit: (code: number) => void }> = []
  const factory = (opts: PtySpawnOptions): PtyHandle => {
    const onData: Array<(c: Uint8Array) => void> = []
    const onExit: Array<(i: { exitCode: number }) => void> = []
    spawned.push({
      opts,
      data: (s) => { for (const cb of onData) cb(new TextEncoder().encode(s)) },
      exit: (code) => { for (const cb of onExit) cb({ exitCode: code }) },
    })
    return {
      pid: 7,
      write() {},
      resize() {},
      kill() {},
      onData(cb) { onData.push(cb) },
      onExit(cb) { onExit.push(cb) },
      dispose() {},
    }
  }
  return { factory, spawned }
}

function fakeFactory(killed: string[]): (opts: PtySpawnOptions) => PtyHandle {
  return (_opts: PtySpawnOptions): PtyHandle => {
    const data: Array<(c: Uint8Array) => void> = []
    const exit: Array<(i: { exitCode: number; signal?: number }) => void> = []
    return {
      pid: 4242,
      write() { /* no-op */ },
      resize() { /* no-op */ },
      kill(sig) { killed.push(sig ?? 'SIGTERM') },
      onData(cb) { data.push(cb) },
      onExit(cb) { exit.push(cb) },
      dispose() { killed.push('dispose') },
    }
  }
}

describe('pty-manager', () => {
  it('creates, writes, resizes, and destroys a session', () => {
    const killed: string[] = []
    const spawn = fakeFactory(killed)
    const pty = createPtyManager({
      spawn,
      logger: pino({ enabled: false }),
      maxSessions: 2,
      fallbackCwd: '/tmp/eyas-oc-test',
    })
    const rec = pty.create(
      { userId: 'u1', conversationId: 'c1', kind: 'shell', workingDirectories: ['/tmp/eyas-oc-test'] },
      { file: '/bin/bash', args: [], env: {} },
    )
    expect(rec.pid).toBe(4242)
    expect(pty.count()).toBe(1)
    pty.write(rec.id, 'pwd\n')
    pty.resize(rec.id, 40, 12)
    expect(pty.get(rec.id)?.cols).toBe(40)
    pty.destroy(rec.id)
    expect(pty.count()).toBe(0)
  })

  it('enforces the session cap', () => {
    const spawn = fakeFactory([])
    const pty = createPtyManager({
      spawn,
      logger: pino({ enabled: false }),
      maxSessions: 1,
      fallbackCwd: '/tmp/eyas-oc-test',
    })
    pty.create(
      { userId: 'u1', conversationId: 'c1', kind: 'shell', workingDirectories: ['/tmp/eyas-oc-test'] },
      { file: '/bin/bash', args: [], env: {} },
    )
    expect(() => pty.create(
      { userId: 'u1', conversationId: 'c1', kind: 'shell', workingDirectories: ['/tmp/eyas-oc-test'] },
      { file: '/bin/bash', args: [], env: {} },
    )).toThrow(/limit/)
  })

  it('destroys the PTY when the last sink detaches', () => {
    const spawn = fakeFactory([])
    const pty = createPtyManager({
      spawn,
      logger: pino({ enabled: false }),
      maxSessions: 2,
      fallbackCwd: '/tmp/eyas-oc-test',
    })
    const rec = pty.create(
      { userId: 'u1', conversationId: 'c1', kind: 'shell', workingDirectories: ['/tmp/eyas-oc-test'] },
      { file: '/bin/bash', args: [], env: {} },
    )
    const sink = { send() {}, closed() {} }
    pty.attach(rec.id, sink)
    pty.detach(rec.id, sink)
    expect(pty.count()).toBe(0)
  })

  describe('memory capture and the TUI plugin key (J10)', () => {
    afterEach(() => { vi.useRealTimers() })

    function manager(opts: { enabled: boolean; capture?: ReturnType<typeof vi.fn> }) {
      const driven = drivenFactory()
      const tokens = createPluginTokenRegistry()
      const capture = opts.capture ?? vi.fn()
      const pty = createPtyManager({
        spawn: driven.factory,
        logger: pino({ enabled: false }),
        maxSessions: 4,
        fallbackCwd: '/tmp/eyas-oc-test',
        capture,
        captureEnabled: () => opts.enabled,
        pluginTokens: tokens,
      })
      return { pty, driven, tokens, capture }
    }

    const open = (pty: ReturnType<typeof createPtyManager>, conversationId: string, kind: 'tui' | 'shell' = 'tui', env: Record<string, string> = {}) =>
      pty.create({ userId: 'u1', conversationId, kind, workingDirectories: ['/tmp/eyas-oc-test'] }, { file: 'opencode', args: [], env })

    it('(+) with the flag on, a conversation\'s terminal output is captured with its user', () => {
      const { pty, driven, capture } = manager({ enabled: true })
      const rec = open(pty, 'conv-1')
      driven.spawned[0]!.data('\u001b[32mREADME.md\u001b[0m\n')
      pty.destroy(rec.id)
      expect(capture).toHaveBeenCalledTimes(1)
      expect(capture).toHaveBeenCalledWith({ sessionId: rec.id, userId: 'u1', conversationId: 'conv-1', text: 'README.md\n', kind: 'tui' })
    })

    it('(−) capture is skipped with the flag off', () => {
      const { pty, driven, capture } = manager({ enabled: false })
      const rec = open(pty, 'conv-1')
      driven.spawned[0]!.data('secret output\n')
      pty.destroy(rec.id)
      expect(capture).not.toHaveBeenCalled()
    })

    it('(−) capture is skipped without a conversationId', () => {
      const { pty, driven, capture } = manager({ enabled: true })
      const rec = open(pty, '')
      driven.spawned[0]!.data('output\n')
      pty.destroy(rec.id)
      expect(capture).not.toHaveBeenCalled()
    })

    it('(+) a TUI gets its own live plugin key for its fd 3 — the environment carries only the marker; (−) it is revoked when the PTY exits', () => {
      const { pty, driven, tokens } = manager({ enabled: false })
      const rec = open(pty, 'conv-1', 'tui', { [OPENCODE_KEY_FD_ENV]: '9', EYAS_OPENCODE_PLUGIN_TOKEN: 'eyas-oc-inherited' })
      const { opts } = driven.spawned[0]!
      const key = opts.pluginKey!
      expect(Buffer.from(key, 'base64url')).toHaveLength(32)
      expect(opts.env[OPENCODE_KEY_FD_ENV]).toBe('3')
      expect(JSON.stringify(opts.env)).not.toContain(key)
      expect(tokens.check(makeSessionProof(key, 'ses_tui'))?.sessionId).toBe('ses_tui')
      driven.spawned[0]!.exit(0)
      expect(pty.get(rec.id)).toBeUndefined()
      expect(tokens.check(makeSessionProof(key, 'ses_tui'))).toBeNull()
      expect(tokens.size()).toBe(0)
    })

    it('(−) a destroyed TUI\'s key is revoked too, and a shell never gets one (nor an inherited marker)', () => {
      const { pty, driven, tokens } = manager({ enabled: false })
      const tui = open(pty, 'conv-1')
      const key = driven.spawned[0]!.opts.pluginKey!
      pty.destroy(tui.id)
      expect(tokens.check(makeSessionProof(key, 'ses_tui'))).toBeNull()
      open(pty, 'conv-1', 'shell', { [OPENCODE_KEY_FD_ENV]: '3' })
      expect(driven.spawned[1]!.opts.pluginKey).toBeUndefined()
      expect(driven.spawned[1]!.opts.env).not.toHaveProperty(OPENCODE_KEY_FD_ENV)
      expect(tokens.size()).toBe(0)
    })

    it('(−) a PTY that fails to spawn leaves no live key', () => {
      const tokens = createPluginTokenRegistry()
      const pty = createPtyManager({
        spawn: () => { throw new Error('no pty') },
        logger: pino({ enabled: false }),
        maxSessions: 2,
        fallbackCwd: '/tmp/eyas-oc-test',
        pluginTokens: tokens,
      })
      expect(() => open(pty, 'conv-1')).toThrow(/no pty/)
      expect(tokens.size()).toBe(0)
    })
  })
})
