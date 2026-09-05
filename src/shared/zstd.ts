// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Runtime-detected zstd for the L0 raw layer (spec §6, spike §2 #13).
// Three tiers, first available wins: Bun.zstdCompressSync → node:zlib zstd
// (Node ≥ 22.15.0; 23.0–23.7 have none) → @bokuweb/zstd-wasm (MIT). All
// three emit RFC 8878 frames and decompress each other's output; frame bytes
// may differ between tiers, which is fine because blob identity is the
// SHA-256 of the UNCOMPRESSED bytes, never of the frame. Level 3 is the
// measured sweet spot (ratio 2.66 on repo text, ~32 µs/msg at 2 vCPU; L6
// buys +4 % ratio for 2–4× CPU). The sync API throws — loudly, never
// silently — until initZstd() has resolved a tier.

export type ZstdTier = 'bun' | 'node' | 'wasm'

export const ZSTD_DEFAULT_LEVEL = 3

export class ZstdUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ZstdUnavailableError'
  }
}

interface ZstdBackend {
  tier: ZstdTier
  compress(data: Uint8Array, level: number): Uint8Array
  decompress(data: Uint8Array): Uint8Array
}

interface ZstdWasmApi {
  init(): Promise<void>
  compress(data: Uint8Array, level?: number): Uint8Array
  decompress(data: Uint8Array): Uint8Array
}

const TIER_ORDER: readonly ZstdTier[] = ['bun', 'node', 'wasm']

let active: ZstdBackend | null = null
let pending: Promise<ZstdTier> | null = null

/** Buffers are Uint8Arrays already; re-view without copying, reject anything else. */
function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  // A non-buffer return means the backend itself is broken, not that no tier
  // is active: zstdTier() still reports one, so ZstdUnavailableError (which
  // callers read as "no active tier") would be a contradictory signal here.
  throw new TypeError(`zstd backend returned an unexpected value (${typeof value})`)
}

const MODULE_ABSENT_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'])

/** True only for a genuine "this module isn't installed" resolution failure — never a fault inside an installed module. */
function isModuleAbsent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && MODULE_ABSENT_CODES.has(String((err as { code?: unknown }).code))
}

async function loadBun(): Promise<ZstdBackend | null> {
  const bun = (globalThis as { Bun?: { zstdCompressSync?: unknown; zstdDecompressSync?: unknown } }).Bun
  if (!bun || typeof bun.zstdCompressSync !== 'function' || typeof bun.zstdDecompressSync !== 'function') return null
  const compressSync = bun.zstdCompressSync as (data: Uint8Array, options: { level: number }) => Uint8Array
  const decompressSync = bun.zstdDecompressSync as (data: Uint8Array) => Uint8Array
  return {
    tier: 'bun',
    compress: (data, level) => asBytes(compressSync(data, { level })),
    decompress: (data) => asBytes(decompressSync(data)),
  }
}

interface NodeZlibZstd {
  zstdCompressSync?: (data: Uint8Array, options: { params: Record<number, number> }) => Uint8Array
  zstdDecompressSync?: (data: Uint8Array) => Uint8Array
  constants: { ZSTD_c_compressionLevel?: number }
}

async function loadNode(): Promise<ZstdBackend | null> {
  let zlib: NodeZlibZstd
  try {
    zlib = (await import('node:zlib')) as unknown as NodeZlibZstd
  } catch (err) {
    // Only a genuine "node:zlib doesn't exist" resolution failure means this
    // tier is absent — anything else (an interop bug, a broken build) must
    // surface rather than silently demote the process to the wasm tier.
    if (isModuleAbsent(err)) return null
    throw err
  }
  if (typeof zlib.zstdCompressSync !== 'function' || typeof zlib.zstdDecompressSync !== 'function') return null
  const levelParam = zlib.constants.ZSTD_c_compressionLevel
  if (typeof levelParam !== 'number') return null
  const compressSync = zlib.zstdCompressSync
  const decompressSync = zlib.zstdDecompressSync
  return {
    tier: 'node',
    compress: (data, level) => asBytes(compressSync(data, { params: { [levelParam]: level } })),
    decompress: (data) => asBytes(decompressSync(data)),
  }
}

// @bokuweb/zstd-wasm's init() is not idempotent: calling it more than once
// per process corrupts the WASM module's internal heap allocator, and later
// compress/decompress calls start failing with spurious zstd error codes.
// The corruption does NOT reliably surface on the very next call — a
// two-call smoke test (init, use, init again, use) can pass while the bug
// is still there; it took a THIRD init() to surface it here (verified
// independently, twice, against this exact test suite's forced tier
// reselection). Cache the promise so init runs at most once per process, no
// matter how many times initZstd('wasm') is called or reselected — do not
// "simplify" this back to a bare `await api.init()` on the strength of a
// short manual test.
let wasmInit: Promise<void> | null = null

async function loadWasm(): Promise<ZstdBackend | null> {
  let mod: ZstdWasmApi & { default?: ZstdWasmApi }
  try {
    // The Node entry is CommonJS; under ESM interop the API may sit on `default`.
    mod = (await import('@bokuweb/zstd-wasm')) as unknown as ZstdWasmApi & { default?: ZstdWasmApi }
  } catch (err) {
    // Only a genuine "package not installed" resolution failure means this
    // tier is absent. Anything else (a truncated payload, an interop bug)
    // must surface, not collapse into the same signal as "not installed".
    if (isModuleAbsent(err)) return null
    throw err
  }
  const api: ZstdWasmApi | undefined = typeof mod.compress === 'function' ? mod : mod.default
  if (!api || typeof api.compress !== 'function' || typeof api.decompress !== 'function') return null
  try {
    if (!wasmInit) wasmInit = api.init()
    await wasmInit
  } catch (err) {
    // Installed but broken is a LOUD failure, not "tier absent" — don't let
    // it collapse into the generic "not installed, please install it"
    // message below, and don't cache the rejection forever: a transient
    // init fault (OOM, a slow cold mount) must be retryable on the next call.
    wasmInit = null
    throw new ZstdUnavailableError('@bokuweb/zstd-wasm is installed but failed to initialise', { cause: err })
  }
  return {
    tier: 'wasm',
    compress: (data, level) => asBytes(api.compress(data, level)),
    decompress: (data) => asBytes(api.decompress(data)),
  }
}

const LOADERS: Record<ZstdTier, () => Promise<ZstdBackend | null>> = { bun: loadBun, node: loadNode, wasm: loadWasm }

async function detect(force?: ZstdTier): Promise<ZstdTier> {
  // Validate tier MEMBERSHIP, not property truthiness: LOADERS is a plain
  // object literal, so an inherited Object.prototype key (e.g. 'toString')
  // would otherwise read as a truthy "loader" and get selected as if it
  // were real. An unknown forced tier is a caller error, not a reselection
  // attempt — it must not disturb an already-working backend, so this check
  // runs before anything below touches `active`.
  if (force !== undefined && !TIER_ORDER.includes(force)) {
    throw new ZstdUnavailableError(`unknown zstd tier '${String(force)}' (expected bun, node or wasm)`)
  }
  const previousActive = active
  const order: readonly ZstdTier[] = force ? [force] : TIER_ORDER
  const misses: string[] = []
  let lastReason: unknown
  for (const tier of order) {
    try {
      const backend = await LOADERS[tier]()
      if (backend) {
        active = backend
        return tier
      }
      misses.push(tier)
    } catch (err) {
      // A loader can now throw for a genuine, non-"absent" fault (see
      // loadNode/loadWasm above). Record it as this tier's reason and keep
      // trying the rest of the ladder rather than aborting outright.
      misses.push(tier)
      lastReason = err
    }
  }
  // A failed FORCED reselection must not disarm an already-working backend
  // — only an unforced full sweep (nothing else can supply a tier) clears
  // it. Restoring here, not skipping the throw, keeps `force` failing loudly
  // while leaving compression armed for the next unforced call.
  active = force ? previousActive : null
  throw new ZstdUnavailableError(
    `no zstd backend available (tried: ${misses.join(', ')}). Run on Bun, on Node >= 22.15.0, or install @bokuweb/zstd-wasm.`,
    lastReason === undefined ? undefined : { cause: lastReason },
  )
}

/**
 * Resolve the best tier once (cached). `force` is for tests and diagnostics:
 * it (re)selects exactly that tier or rejects with ZstdUnavailableError.
 */
export function initZstd(force?: ZstdTier): Promise<ZstdTier> {
  if (force) return detect(force)
  if (active) return Promise.resolve(active.tier)
  if (!pending) {
    pending = detect().finally(() => { pending = null })
  }
  return pending
}

export function zstdTier(): ZstdTier | 'none' {
  return active?.tier ?? 'none'
}

function requireBackend(operation: string): ZstdBackend {
  if (!active) throw new ZstdUnavailableError(`zstd ${operation} called before initZstd() resolved a tier`)
  return active
}

export function zstdCompress(data: Uint8Array, level: number = ZSTD_DEFAULT_LEVEL): Uint8Array {
  return requireBackend('compress').compress(data, level)
}

export function zstdDecompress(data: Uint8Array): Uint8Array {
  return requireBackend('decompress').decompress(data)
}

/** Tests only: forget the selected tier so the ladder runs again. */
export function resetZstdForTests(): void {
  active = null
  pending = null
}
