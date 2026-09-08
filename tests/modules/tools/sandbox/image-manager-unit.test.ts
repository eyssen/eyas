// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createImageManager } from '@modules/tools/sandbox/image-manager'

class MockChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
}

function makeSpawnFn(responder: (cmd: string, args: string[], child: MockChild) => void) {
  const calls: Array<{ cmd: string; args: string[] }> = []
  const fn: any = (cmd: string, args: string[]) => {
    const child = new MockChild()
    calls.push({ cmd, args })
    queueMicrotask(() => responder(cmd, args, child))
    return child
  }
  return { fn, calls }
}

describe('sandbox/image-manager', () => {
  it('imageExists returns true when `docker image inspect` exits 0', async () => {
    const { fn } = makeSpawnFn((_cmd, _args, child) => child.emit('close', 0))
    const mgr = createImageManager({ spawnFn: fn })
    expect(await mgr.imageExists('alpine:latest')).toBe(true)
  })

  it('imageExists returns false on non-zero exit', async () => {
    const { fn } = makeSpawnFn((_cmd, _args, child) => child.emit('close', 1))
    const mgr = createImageManager({ spawnFn: fn })
    expect(await mgr.imageExists('missing:tag')).toBe(false)
  })

  it('imageExists returns false when spawn errors', async () => {
    const fn: any = () => {
      const child = new MockChild()
      queueMicrotask(() => child.emit('error', new Error('ENOENT')))
      return child
    }
    const mgr = createImageManager({ spawnFn: fn })
    expect(await mgr.imageExists('any')).toBe(false)
  })

  it('pullImage returns 0 on success', async () => {
    const { fn, calls } = makeSpawnFn((_cmd, args, child) => {
      expect(args[0]).toBe('pull')
      child.emit('close', 0)
    })
    const mgr = createImageManager({ spawnFn: fn })
    expect(await mgr.pullImage('alpine:latest')).toBe(0)
    expect(calls[0].args).toEqual(['pull', 'alpine:latest'])
  })

  it('pullImage returns non-zero on failure and logs warning', async () => {
    const warns: unknown[] = []
    const { fn } = makeSpawnFn((_cmd, _args, child) => {
      child.stderr.write('unauthorized')
      child.emit('close', 1)
    })
    const mgr = createImageManager({
      spawnFn: fn,
      logger: {
        info: () => {},
        warn: (o) => warns.push(o),
        debug: () => {},
      },
    })
    expect(await mgr.pullImage('private:latest')).toBe(1)
    expect(warns.length).toBeGreaterThan(0)
  })

  it('ensureImage short-circuits when image already exists', async () => {
    const { fn, calls } = makeSpawnFn((_cmd, args, child) => {
      expect(args[0]).toBe('image')
      child.emit('close', 0)
    })
    const mgr = createImageManager({ spawnFn: fn })
    expect(await mgr.ensureImage('alpine:latest')).toBe(true)
    expect(calls.length).toBe(1) // only inspect, no pull
  })

  it('ensureImage pulls when image missing and autoPull default', async () => {
    let step = 0
    const fn: any = (_cmd: string, args: string[]) => {
      const child = new MockChild()
      queueMicrotask(() => {
        if (step === 0) {
          // inspect: missing
          step++
          child.emit('close', 1)
        } else {
          // pull: success
          expect(args[0]).toBe('pull')
          child.emit('close', 0)
        }
      })
      return child
    }
    const mgr = createImageManager({ spawnFn: fn })
    expect(await mgr.ensureImage('alpine:latest')).toBe(true)
  })

  it('ensureImage with autoPull=false returns false for missing image', async () => {
    const { fn, calls } = makeSpawnFn((_cmd, _args, child) => child.emit('close', 1))
    const mgr = createImageManager({ spawnFn: fn })
    expect(await mgr.ensureImage('missing', { autoPull: false })).toBe(false)
    expect(calls.length).toBe(1) // only inspect, no pull
  })
})
