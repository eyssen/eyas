import { timingSafeEqual } from 'crypto'
import { isBun } from './platform.js'

export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ULID: Crockford Base32, 10 chars timestamp + 16 chars random, monotonic
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
let lastTime = 0
let lastRandom = 0n

export function generateId(): string {
  let now = Date.now()
  if (now <= lastTime) {
    // Same millisecond: increment random part for monotonicity
    lastRandom += 1n
  } else {
    lastTime = now
    const bytes = new Uint8Array(10)
    crypto.getRandomValues(bytes)
    lastRandom = bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)
  }

  // Encode timestamp (10 chars)
  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time
    t = Math.floor(t / 32)
  }

  // Encode random (16 chars)
  let random = ''
  let r = lastRandom
  for (let i = 0; i < 16; i++) {
    random = ENCODING[Number(r % 32n)] + random
    r = r / 32n
  }

  return time + random
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
