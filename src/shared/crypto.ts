import { timingSafeEqual } from 'crypto'
import { isBun } from './platform.js'

export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ULID: Crockford Base32, 10 chars timestamp (48-bit ms) + 16 chars random
// (80 bits), monotonic within a millisecond. generateId() is the runtime id
// source; generateIdAt() is the deterministic sibling the memory migration
// uses (timestamp from the source row, random part from a hash) so a re-run
// derives byte-identical ids and INSERT OR IGNORE makes it idempotent.
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const DECODING: Record<string, number> = Object.fromEntries(Array.from(ENCODING, (c, i) => [c, i]))
const ULID_TIME_MAX = 2 ** 48 - 1
const ULID_RANDOM_BYTES = 10
const ULID_RANDOM_MASK = (1n << 80n) - 1n
let lastTime = 0
let lastRandom = 0n

function encodeUlidTime(ms: number): string {
  let time = ''
  let t = ms
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time
    t = Math.floor(t / 32)
  }
  return time
}

function encodeUlidRandom(random: bigint): string {
  let out = ''
  let r = random & ULID_RANDOM_MASK
  for (let i = 0; i < 16; i++) {
    out = ENCODING[Number(r % 32n)] + out
    r = r / 32n
  }
  return out
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  return bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)
}

// Error messages below echo the rejected value for diagnostics; truncate it
// so an arbitrarily large/untrusted string never gets dumped whole into a log.
function truncateForError(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}…` : value
}

export function generateId(): string {
  const now = Date.now()
  if (now <= lastTime) {
    // Same millisecond: increment random part for monotonicity
    lastRandom += 1n
  } else {
    lastTime = now
    const bytes = new Uint8Array(ULID_RANDOM_BYTES)
    crypto.getRandomValues(bytes)
    lastRandom = bytesToBigInt(bytes)
  }
  return encodeUlidTime(now) + encodeUlidRandom(lastRandom)
}

/**
 * Deterministic ULID: `ms` is the 48-bit timestamp, `random80` the ten
 * random bytes. Same inputs → same id. The memory migration derives both
 * from the legacy row, so re-running it re-creates identical ids.
 */
export function generateIdAt(ms: number, random80: Uint8Array): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > ULID_TIME_MAX) {
    throw new RangeError(`ULID timestamp must be an integer in [0, ${ULID_TIME_MAX}], got ${ms}`)
  }
  if (random80.length !== ULID_RANDOM_BYTES) {
    throw new RangeError(`ULID random part must be exactly ${ULID_RANDOM_BYTES} bytes, got ${random80.length}`)
  }
  return encodeUlidTime(ms) + encodeUlidRandom(bytesToBigInt(random80))
}

/**
 * The millisecond timestamp encoded in a ULID's first 10 characters.
 * All 26 characters are validated against the Crockford alphabet (not just
 * the first 10) so a string with a garbage tail is rejected, not silently
 * accepted with its timestamp half read out from under it.
 */
export function ulidTimestampMs(id: string): number {
  if (typeof id !== 'string' || id.length !== 26) {
    throw new RangeError(`not a ULID (expected 26 characters): ${truncateForError(String(id))}`)
  }
  let ms = 0
  for (let i = 0; i < 26; i++) {
    const ch = id[i].toUpperCase()
    const value = DECODING[ch]
    if (value === undefined) {
      throw new RangeError(`not a ULID (bad character '${id[i]}' at ${i}): ${truncateForError(id)}`)
    }
    if (i < 10) ms = ms * 32 + value
  }
  if (ms > ULID_TIME_MAX) throw new RangeError(`not a ULID (timestamp overflows 48 bits): ${truncateForError(id)}`)
  return ms
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return timingSafeEqual(bufA, bufB)
}

export async function hashPassword(password: string): Promise<string> {
  if (isBun) {
    return Bun.password.hash(password, { algorithm: 'argon2id' })
  }
  const { hash } = await import('argon2')
  return hash(password)
}

export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  if (isBun) {
    return Bun.password.verify(password, hashed)
  }
  const { verify } = await import('argon2')
  return verify(hashed, password)
}
