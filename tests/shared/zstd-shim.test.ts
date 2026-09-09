// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Port of the Phase 0 spike's zstd-shim.test.ts (spike §5): round-trip on
// every available tier, WASM ↔ native interchange, forced-tier selection,
// and a LOUD failure before a tier is selected.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  initZstd, zstdCompress, zstdDecompress, zstdTier, resetZstdForTests,
  ZstdUnavailableError, ZSTD_DEFAULT_LEVEL, type ZstdTier,
} from '@shared/zstd'

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
const enc = (s: string) => new TextEncoder().encode(s)
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const samples: Uint8Array[] = [
  new Uint8Array(0),
  enc('x'),
  enc('Árvíztűrő tükörfúrógép — a NAV online számla riport 30 napos határidővel. '.repeat(40)),
  enc('export const sweep = async (db) => { for (let lo = 1; lo <= max; lo += 2000) await Bun.sleep(1); };\n'.repeat(120)),
  crypto.getRandomValues(new Uint8Array(20 * 1024)), // incompressible
]

beforeEach(() => resetZstdForTests())

describe('zstd shim', () => {
  it('fails loudly before init instead of silently storing nothing', () => {
    expect(zstdTier()).toBe('none')
    expect(() => zstdCompress(enc('x'))).toThrow(ZstdUnavailableError)
    expect(() => zstdDecompress(enc('x'))).toThrow(ZstdUnavailableError)
  })

  it('auto-detects the runtime tier: bun under Bun, node or wasm under Node', async () => {
    const tier = await initZstd()
    if (isBun) expect(tier).toBe('bun')
    else expect(['node', 'wasm']).toContain(tier)
    expect(zstdTier()).toBe(tier)
    expect(await initZstd()).toBe(tier) // cached
  })

  for (const tier of ['bun', 'node', 'wasm'] as ZstdTier[]) {
    it(`round-trips every sample on the ${tier} tier (passes trivially where that tier is unavailable)`, async () => {
      let selected: ZstdTier
      try {
        selected = await initZstd(tier)
      } catch (err) {
        expect(err).toBeInstanceOf(ZstdUnavailableError)
        return
      }
      expect(selected).toBe(tier)
      for (const s of samples) {
        const c = zstdCompress(s, ZSTD_DEFAULT_LEVEL)
        expect(hex(c.subarray(0, 4))).toBe('28b52ffd') // zstd magic (RFC 8878)
        expect(hex(zstdDecompress(c))).toBe(hex(s))
      }
    })
  }

  it('the WASM tier is always present (pinned dependency) and interchanges frames with the native tier', async () => {
    expect(await initZstd('wasm')).toBe('wasm')
    const wasmFrames = samples.map((s) => zstdCompress(s))
    // MUST reset: initZstd() is cached, so without this the next call returns
    // the 'wasm' tier just forced above and the whole cross-check below is dead.
    resetZstdForTests()
    const native = await initZstd()
    if (native === 'wasm') return // a Node without zstd: nothing native to cross-check
    for (let i = 0; i < samples.length; i++) {
      expect(hex(zstdDecompress(wasmFrames[i]))).toBe(hex(samples[i])) // wasm → native
    }
    const nativeFrames = samples.map((s) => zstdCompress(s))
    await initZstd('wasm')
    for (let i = 0; i < samples.length; i++) {
      expect(hex(zstdDecompress(nativeFrames[i]))).toBe(hex(samples[i])) // native → wasm
    }
  })

  it('compresses real text by more than 2x at level 3 (spike: 2.66 on repo text)', async () => {
    await initZstd()
    const text = samples[2]
    expect(zstdCompress(text, 3).byteLength * 2).toBeLessThan(text.byteLength)
  })

  it('rejects an unknown tier with ZstdUnavailableError', async () => {
    await expect(initZstd('brotli' as unknown as ZstdTier)).rejects.toBeInstanceOf(ZstdUnavailableError)
    expect(zstdTier()).toBe('none')
  })

  it('rejects a forced tier that is only an inherited Object.prototype property, not real tier membership', async () => {
    // Regression for a real bug: LOADERS is a plain object literal, so
    // `LOADERS['toString']` is truthy (a function) even though 'toString'
    // is not one of the three tiers — a naive `if (!loader)` guard would
    // have accepted it and returned 'toString' as the selected tier.
    await expect(initZstd('toString' as unknown as ZstdTier)).rejects.toBeInstanceOf(ZstdUnavailableError)
    expect(zstdTier()).toBe('none')
  })

  it('a failed forced reselection does not disarm an already-active backend', async () => {
    const working = await initZstd()
    expect(zstdTier()).toBe(working)
    await expect(initZstd('doesNotExist' as unknown as ZstdTier)).rejects.toBeInstanceOf(ZstdUnavailableError)
    // The working backend must still be selected — a bogus forced probe
    // must not silently disarm L0 compression as a side effect of failing.
    expect(zstdTier()).toBe(working)
    expect(zstdCompress(enc('x')).byteLength).toBeGreaterThan(0)
  })
})
