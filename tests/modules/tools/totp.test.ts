// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { decodeBase32, generateTotp, parseTotpSecret } from '@modules/tools/builtin/totp'
import { readOsKeychainPassword } from '@modules/secrets/providers/os-keychain'

/** RFC 6238 Appendix B — ASCII seed "12345678901234567890". */
const RFC_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('decodeBase32', () => {
  it('decodes the RFC 6238 seed', () => {
    expect(decodeBase32(RFC_SEED).toString('ascii')).toBe('12345678901234567890')
  })

  it('rejects invalid alphabet', () => {
    expect(() => decodeBase32('????')).toThrow(/base32/i)
  })
})

describe('parseTotpSecret', () => {
  it('accepts raw base32', () => {
    expect(parseTotpSecret(RFC_SEED)).toMatchObject({ digits: 6, period: 30, algorithm: 'sha1' })
  })

  it('parses otpauth://totp URIs', () => {
    const parsed = parseTotpSecret(
      `otpauth://totp/GitHub:eyas?secret=${RFC_SEED}&issuer=GitHub&algorithm=SHA256&digits=8&period=60`,
    )
    expect(parsed).toEqual({
      secret: RFC_SEED,
      digits: 8,
      period: 60,
      algorithm: 'sha256',
    })
  })

  it('refuses HOTP URIs', () => {
    expect(() => parseTotpSecret(`otpauth://hotp/x?secret=${RFC_SEED}`)).toThrow(/HOTP/i)
  })
})

describe('generateTotp RFC 6238 SHA-1', () => {
  it('matches the 8-digit vector at T=59', () => {
    const out = generateTotp(RFC_SEED, { now: 59_000, digits: 8 })
    expect(out.code).toBe('94287082')
    expect(out.remainingSeconds).toBe(1)
  })

  it('matches the 8-digit vector at T=1111111109', () => {
    const out = generateTotp(RFC_SEED, { now: 1_111_111_109_000, digits: 8 })
    expect(out.code).toBe('07081804')
  })

  it('returns 6 digits by default', () => {
    const out = generateTotp(RFC_SEED, { now: 59_000 })
    expect(out.code).toBe('287082')
    expect(out.digits).toBe(6)
  })
})

describe('readOsKeychainPassword', () => {
  it('returns null on non-darwin platforms', async () => {
    const execFile = async () => {
      throw new Error('should not spawn')
    }
    await expect(readOsKeychainPassword('eyas-totp-github', undefined, {
      platform: 'linux',
      execFile,
    })).resolves.toBeNull()
  })

  it('returns the password on darwin and never throws on miss', async () => {
    const execFile = async (_file: string, args: string[]) => {
      expect(args).toContain('find-generic-password')
      expect(args).toContain('eyas-totp-github')
      return { stdout: 'JBSWY3DPEHPK3PXP\n', stderr: '' }
    }
    await expect(readOsKeychainPassword('eyas-totp-github', undefined, {
      platform: 'darwin',
      execFile,
    })).resolves.toBe('JBSWY3DPEHPK3PXP')

    const miss = async () => {
      throw new Error('The specified item could not be found in the keychain.')
    }
    await expect(readOsKeychainPassword('missing', undefined, {
      platform: 'darwin',
      execFile: miss,
    })).resolves.toBeNull()
  })
})
