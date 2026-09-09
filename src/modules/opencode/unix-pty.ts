// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// POSIX PTY via bun:ffi. No node-pty native addon (Bun + Docker are hostile
// to node-gyp). Windows is unavailable — doctor reports a remedy.

import { dlopen, FFIType, ptr } from 'bun:ffi'
import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, openSync, read, writeSync, constants as fsConstants } from 'node:fs'
import type { PtyFactory, PtyHandle, PtySpawnOptions } from './types.js'

const O_RDWR = 0x0002

interface LibcSymbols {
  posix_openpt: (flags: number) => number
  grantpt: (fd: number) => number
  unlockpt: (fd: number) => number
  ptsname: (fd: number) => unknown
  ioctl: (fd: number, request: number | bigint, arg: unknown) => number
  close: (fd: number) => number
}

let cached: LibcSymbols | null | undefined

function loadLibc(): LibcSymbols | null {
  if (cached !== undefined) return cached
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    cached = null
    return null
  }
  try {
    const name = process.platform === 'darwin' ? 'libSystem.B.dylib' : 'libc.so.6'
    const lib = dlopen(name, {
      posix_openpt: { args: [FFIType.i32], returns: FFIType.i32 },
      grantpt: { args: [FFIType.i32], returns: FFIType.i32 },
      unlockpt: { args: [FFIType.i32], returns: FFIType.i32 },
      ptsname: { args: [FFIType.i32], returns: FFIType.cstring },
      ioctl: { args: [FFIType.i32, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
      close: { args: [FFIType.i32], returns: FFIType.i32 },
    })
    cached = {
      posix_openpt: (flags) => lib.symbols.posix_openpt(flags),
      grantpt: (fd) => lib.symbols.grantpt(fd),
      unlockpt: (fd) => lib.symbols.unlockpt(fd),
      ptsname: (fd) => lib.symbols.ptsname(fd),
      ioctl: (fd, request, arg) =>
        lib.symbols.ioctl(fd, request as never, ptr(arg as Uint8Array) as never),
      close: (fd) => lib.symbols.close(fd),
    }
    return cached
  } catch {
    cached = null
    return null
  }
}

export function isUnixPtyAvailable(): boolean {
  return loadLibc() !== null
}

function tioCswinsz(): number {
  return process.platform === 'darwin' ? 0x80087467 : 0x5414
}

function oNoctty(): number {
  return process.platform === 'darwin' ? 0x20000 : 0x100
}

function ptsNameOf(lib: LibcSymbols, fd: number): string {
  const p = lib.ptsname(fd)
  if (p == null) return ''
  return String(p)
}

function setWinsize(lib: LibcSymbols, fd: number, cols: number, rows: number): void {
  const buf = Buffer.alloc(8)
  buf.writeUInt16LE(rows, 0)
  buf.writeUInt16LE(cols, 2)
  lib.ioctl(fd, tioCswinsz(), buf)
}

export function unixPtyFactory(): PtyFactory {
  return (opts: PtySpawnOptions): PtyHandle => {
    const lib = loadLibc()
    if (!lib) throw new Error('POSIX PTY is not available on this platform')

    const master = lib.posix_openpt(O_RDWR | oNoctty())
    if (master < 0) throw new Error('posix_openpt failed')
    if (lib.grantpt(master) !== 0) {
      lib.close(master)
      throw new Error('grantpt failed')
    }
    if (lib.unlockpt(master) !== 0) {
      lib.close(master)
      throw new Error('unlockpt failed')
    }
    const slaveName = ptsNameOf(lib, master)
    if (!slaveName) {
      lib.close(master)
      throw new Error('ptsname failed')
    }

    setWinsize(lib, master, opts.cols, opts.rows)

    const slaveFd = openSync(slaveName, fsConstants.O_RDWR | fsConstants.O_NOCTTY)
    let child: ChildProcess
    try {
      child = spawn(opts.file, opts.args, {
        cwd: opts.cwd,
        env: opts.env,
        detached: true,
        stdio: [slaveFd, slaveFd, slaveFd],
      })
    } finally {
      try { closeSync(slaveFd) } catch { /* parent copy */ }
    }

    const pid = child.pid
    if (typeof pid !== 'number') {
      lib.close(master)
      throw new Error('failed to spawn PTY child')
    }

    const dataListeners: Array<(chunk: Uint8Array) => void> = []
    const exitListeners: Array<(info: { exitCode: number; signal?: number }) => void> = []
    let disposed = false
    const buf = Buffer.alloc(65_536)

    const pump = (): void => {
      if (disposed) return
      read(master, buf, 0, buf.length, null, (err, bytes) => {
        if (disposed) return
        if (err) {
          if (err.code === 'EAGAIN' || err.code === 'EWOULDBLOCK') {
            setTimeout(pump, 8)
            return
          }
          return
        }
        if (bytes && bytes > 0) {
          const slice = Uint8Array.from(buf.subarray(0, bytes))
          for (const cb of dataListeners) cb(slice)
        }
        pump()
      })
    }
    pump()

    child.on('exit', (code, signal) => {
      const mapped = signal ? Number.parseInt(String(signal), 10) : undefined
      for (const cb of exitListeners) {
        cb({ exitCode: code ?? 1, signal: Number.isFinite(mapped) ? mapped : undefined })
      }
    })

    return {
      pid,
      write(data: string) {
        if (disposed) return
        writeSync(master, data)
      },
      resize(cols: number, rows: number) {
        if (disposed) return
        setWinsize(lib, master, cols, rows)
        try { child.kill('SIGWINCH') } catch { /* gone */ }
      },
      kill(signal: NodeJS.Signals = 'SIGTERM') {
        if (disposed) return
        try { child.kill(signal) } catch { /* gone */ }
      },
      onData(cb) { dataListeners.push(cb) },
      onExit(cb) { exitListeners.push(cb) },
      dispose() {
        if (disposed) return
        disposed = true
        try { child.kill('SIGTERM') } catch { /* gone */ }
        setTimeout(() => {
          try { child.kill('SIGKILL') } catch { /* gone */ }
        }, 800)
        try { lib.close(master) } catch { /* already closed */ }
      },
    }
  }
}
