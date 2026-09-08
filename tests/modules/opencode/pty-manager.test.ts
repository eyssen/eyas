// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createPtyManager } from '@modules/opencode/pty-manager'
import type { PtyHandle, PtySpawnOptions } from '@modules/opencode/types'
import pino from 'pino'

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
})
