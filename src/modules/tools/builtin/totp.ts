// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createHmac } from 'node:crypto'

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512'

export interface TotpOptions {
  now?: number
  digits?: number
  period?: number
  algorithm?: TotpAlgorithm
}

export interface TotpCode {
  code: string
  digits: number
  periodSeconds: number
  remainingSeconds: number
  algorithm: TotpAlgorithm
}

export interface ParsedTotpSecret {
  secret: string
  digits: number
  period: number
  algorithm: TotpAlgorithm
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function decodeBase32(input: string): Buffer {
  const cleaned = input.replace(/[\s=-]+/g, '').toUpperCase()
  if (!cleaned) throw new Error('TOTP secret is empty')
  let bits = ''
  for (const ch of cleaned) {
    const v = BASE32_ALPHABET.indexOf(ch)
    if (v < 0) throw new Error('TOTP secret is not valid base32')
    bits += v.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  if (!bytes.length) throw new Error('TOTP secret is not valid base32')
  return Buffer.from(bytes)
}

function parseAlgorithm(raw: string | null | undefined): TotpAlgorithm {
  const a = (raw ?? 'sha1').toLowerCase().replace(/-/g, '')
  if (a === 'sha1' || a === 'sha256' || a === 'sha512') return a
  throw new Error(`Unsupported TOTP algorithm: ${raw}`)
}

/**
 * Accept a raw base32 seed or an `otpauth://totp/...` URI.
 * HOTP URIs are refused — this tool only produces time-based codes.
 */
export function parseTotpSecret(raw: string): ParsedTotpSecret {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('TOTP secret is empty')
  if (/^otpauth:\/\//i.test(trimmed)) {
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      throw new Error('TOTP otpauth URI is invalid')
    }
    if (url.protocol !== 'otpauth:') throw new Error('TOTP otpauth URI is invalid')
    if (url.host.toLowerCase() !== 'totp') {
      throw new Error('Only otpauth://totp secrets are supported (not HOTP)')
    }
    const secret = url.searchParams.get('secret')
    if (!secret) throw new Error('otpauth URI is missing secret=')
    const digitsRaw = url.searchParams.get('digits')
    const periodRaw = url.searchParams.get('period')
    const digits = digitsRaw ? Number(digitsRaw) : 6
    const period = periodRaw ? Number(periodRaw) : 30
    if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
      throw new Error('TOTP digits must be 6, 7, or 8')
    }
    if (!Number.isInteger(period) || period < 15 || period > 120) {
      throw new Error('TOTP period must be between 15 and 120 seconds')
    }
    return {
      secret,
      digits,
      period,
      algorithm: parseAlgorithm(url.searchParams.get('algorithm')),
    }
  }
  return { secret: trimmed, digits: 6, period: 30, algorithm: 'sha1' }
}

function dynamicTruncate(hmac: Buffer): number {
  const offset = hmac[hmac.length - 1]! & 0x0f
  return (
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff)
  )
}

/** RFC 6238 TOTP. Default: SHA-1, 6 digits, 30 s period. */
export function generateTotp(secret: string, opts: TotpOptions = {}): TotpCode {
  const parsed = parseTotpSecret(secret)
  const digits = opts.digits ?? parsed.digits
  const period = opts.period ?? parsed.period
  const algorithm = opts.algorithm ?? parsed.algorithm
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new Error('TOTP digits must be 6, 7, or 8')
  }
  if (!Number.isInteger(period) || period < 15 || period > 120) {
    throw new Error('TOTP period must be between 15 and 120 seconds')
  }
  const now = opts.now ?? Date.now()
  const counter = Math.floor(now / 1000 / period)
  const remainingSeconds = period - (Math.floor(now / 1000) % period)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const hmac = createHmac(algorithm, decodeBase32(parsed.secret)).update(buf).digest()
  const bin = dynamicTruncate(hmac)
  const code = (bin % 10 ** digits).toString().padStart(digits, '0')
  return { code, digits, periodSeconds: period, remainingSeconds, algorithm }
}
