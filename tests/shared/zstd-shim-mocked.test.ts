// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Fix-round regression coverage for two Task 3 review findings that can
// only be exercised with a deliberately broken @bokuweb/zstd-wasm: an
// installed-but-failing init() (finding 1), and a backend returning a
// non-buffer value (finding 5). Mocked in its own file — vitest isolates
// test files by default (separate module registry per file) — so the
// real-runtime round-trip suite in zstd-shim.test.ts never sees a mocked
// dependency, and each test here re-imports a fresh copy of the shim after
// mocking so its module-level `active`/`wasmInit` state can't leak either.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.doUnmock('@bokuweb/zstd-wasm')
  vi.resetModules()
})

describe('zstd shim — mocked @bokuweb/zstd-wasm', () => {
  it('an installed-but-failing WASM init surfaces ZstdUnavailableError with the real cause, and is retryable', async () => {
    const initError = new Error('wasm compile failed: bad magic number')
    const init = vi.fn().mockRejectedValueOnce(initError).mockResolvedValue(undefined)
    vi.doMock('@bokuweb/zstd-wasm', () => ({
      init,
      compress: vi.fn((d: Uint8Array) => d),
      decompress: vi.fn((d: Uint8Array) => d),
    }))
    const fresh = await import('@shared/zstd')
    fresh.resetZstdForTests()

    try {
      await fresh.initZstd('wasm')
      throw new Error('expected initZstd(\'wasm\') to reject on a failing init()')
    } catch (err) {
      // detect()'s terminal throw is always the generic "no zstd backend
      // available" summary (single 'wasm' tier attempted here); the specific
      // "failed to initialise" error loadWasm() raised is chained one level
      // down via `cause`, and the real init() error one level below that —
      // the whole chain survives, none of it is discarded.
      expect(err).toBeInstanceOf(fresh.ZstdUnavailableError)
      const innerCause = (err as Error).cause
      expect(innerCause).toBeInstanceOf(fresh.ZstdUnavailableError)
      expect((innerCause as Error).message).toContain('failed to initialise')
      expect((innerCause as Error).cause).toBe(initError)
    }
    expect(fresh.zstdTier()).toBe('none')
    expect(init).toHaveBeenCalledTimes(1)

    // Retryable: a failed init must not be cached forever (wasmInit reset to
    // null on the throw above), so the very next call tries init() again.
    const tier = await fresh.initZstd('wasm')
    expect(tier).toBe('wasm')
    expect(init).toHaveBeenCalledTimes(2)
  })

  it('a backend returning a non-buffer value throws TypeError (broken backend), not ZstdUnavailableError (absent tier)', async () => {
    vi.doMock('@bokuweb/zstd-wasm', () => ({
      init: vi.fn().mockResolvedValue(undefined),
      compress: vi.fn(() => 'not-a-buffer'),
      decompress: vi.fn((d: Uint8Array) => d),
    }))
    const fresh = await import('@shared/zstd')
    fresh.resetZstdForTests()

    const tier = await fresh.initZstd('wasm')
    expect(tier).toBe('wasm')
    expect(() => fresh.zstdCompress(new TextEncoder().encode('x'))).toThrow(TypeError)
    // zstdTier() still reports 'wasm': the backend is broken, not absent —
    // a contradictory pair of signals (active tier + "no tier" error) is
    // exactly what the old ZstdUnavailableError-from-asBytes produced.
    expect(fresh.zstdTier()).toBe('wasm')
  })
})
