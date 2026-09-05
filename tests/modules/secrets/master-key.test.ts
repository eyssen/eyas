import { describe, it, expect, afterEach } from 'vitest'
import { resolveMasterKey, storeMasterKeyToFile } from '@modules/secrets/master-key'
import { generateMasterKey, exportKey } from '@modules/secrets/crypto'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('master key provider chain', () => {
  const originalEnv = process.env.EYAS_MASTER_KEY
  const testKeyFile = join(tmpdir(), `eyas-test-master-${Date.now()}.key`)

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.EYAS_MASTER_KEY = originalEnv
    } else {
      delete process.env.EYAS_MASTER_KEY
    }
    try { rmSync(testKeyFile) } catch {}
  })

  it('resolves from EYAS_MASTER_KEY env var (hex)', async () => {
    const key = await generateMasterKey()
    const hex = await exportKey(key)
    process.env.EYAS_MASTER_KEY = hex

    const result = await resolveMasterKey()
    expect(result).not.toBeNull()
    const resultHex = await exportKey(result!.key)
    expect(resultHex).toBe(hex)
    expect(result!.source).toBe('env')
  })

  it('resolves from key file', async () => {
    delete process.env.EYAS_MASTER_KEY
    const key = await generateMasterKey()
    const hex = await exportKey(key)
    storeMasterKeyToFile(hex, testKeyFile)

    const result = await resolveMasterKey({ keyFilePath: testKeyFile })
    expect(result).not.toBeNull()
    const resultHex = await exportKey(result!.key)
    expect(resultHex).toBe(hex)
    expect(result!.source).toBe('file')
  })

  it('returns null when no source is available', async () => {
    delete process.env.EYAS_MASTER_KEY
    const result = await resolveMasterKey({ keyFilePath: '/tmp/nonexistent-eyas-key' })
    expect(result).toBeNull()
  })

  it('rejects invalid hex in env var', async () => {
    process.env.EYAS_MASTER_KEY = 'not-valid-hex'
    await expect(resolveMasterKey()).rejects.toThrow()
  })

  it('rejects too-short hex in env var', async () => {
    process.env.EYAS_MASTER_KEY = 'abcd1234'
    await expect(resolveMasterKey()).rejects.toThrow()
  })

  describe('storeMasterKeyToFile', () => {
    it('writes key file with correct content', async () => {
      const key = await generateMasterKey()
      const hex = await exportKey(key)
      const ok = storeMasterKeyToFile(hex, testKeyFile)
      expect(ok).toBe(true)
      expect(existsSync(testKeyFile)).toBe(true)
    })
  })
})
