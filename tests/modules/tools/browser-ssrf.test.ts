import { describe, it, expect } from 'vitest'
import { isPrivateOrLocalHost, assertSafeBrowserUrl } from '@modules/tools/builtin/browser-session'

describe('browser SSRF guards', () => {
  it('flags private and metadata hosts', () => {
    expect(isPrivateOrLocalHost('127.0.0.1')).toBe(true)
    expect(isPrivateOrLocalHost('10.0.0.5')).toBe(true)
    expect(isPrivateOrLocalHost('192.168.1.1')).toBe(true)
    expect(isPrivateOrLocalHost('169.254.169.254')).toBe(true)
    expect(isPrivateOrLocalHost('localhost')).toBe(true)
    expect(isPrivateOrLocalHost('example.com')).toBe(false)
  })

  it('blocks private navigate by default', () => {
    expect(() => assertSafeBrowserUrl('http://127.0.0.1/admin')).toThrow(/SSRF/i)
    expect(() => assertSafeBrowserUrl('https://example.com/ok')).not.toThrow()
  })

  it('allows private when opted in', () => {
    expect(() => assertSafeBrowserUrl('http://10.0.0.1/', true)).not.toThrow()
  })
})
