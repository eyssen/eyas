// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D2 — locality facts are pure string logic: which host a URL names, and
// whether that host is provably this machine. No DNS; anything else is remote.

import { describe, it, expect } from 'vitest'
import { hostOf, isLoopbackHost } from '@shared/endpoint-locality'

describe('hostOf', () => {
  it('returns the lower-case host of an absolute URL', () => {
    expect(hostOf('http://localhost:11434')).toBe('localhost')
    expect(hostOf('http://GPU.LAN:11434/api')).toBe('gpu.lan')
    expect(hostOf('https://api.openai.com/v1')).toBe('api.openai.com')
    expect(hostOf('http://127.0.0.1:8000/v1')).toBe('127.0.0.1')
    expect(hostOf('  http://gpu:11434  ')).toBe('gpu')
  })

  it('strips IPv6 brackets and uses the canonical host form', () => {
    expect(hostOf('http://[::1]:1234')).toBe('::1')
    expect(hostOf('http://[0:0:0:0:0:0:0:1]:1234')).toBe('::1')
    expect(hostOf('http://127.1:11434')).toBe('127.0.0.1')
    expect(hostOf('http://0x7f000001/')).toBe('127.0.0.1')
  })

  it('returns undefined for a malformed URL, a scheme-less host:port or no host', () => {
    expect(hostOf('not a url')).toBeUndefined()
    expect(hostOf('http://')).toBeUndefined()
    expect(hostOf('gpu:11434')).toBeUndefined()
    expect(hostOf('localhost:11434')).toBeUndefined()
    expect(hostOf('file:///etc/hosts')).toBeUndefined()
    expect(hostOf('')).toBeUndefined()
    expect(hostOf(undefined)).toBeUndefined()
    expect(hostOf(null)).toBeUndefined()
  })
})

describe('isLoopbackHost', () => {
  it('accepts every loopback form', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.0.0.53', '127.255.255.255', '::1', '[::1]']) {
      expect(isLoopbackHost(host), host).toBe(true)
    }
  })

  it('rejects private ranges, the unspecified address and names that need DNS', () => {
    for (const host of [
      '10.0.1.57', '192.168.1.10', '172.16.0.1', '0.0.0.0', '::', 'gpu.lan', 'gpu', 'api.openai.com',
      'foo.localhost', 'localhost.evil.com', '127.0.0.1.nip.io', '127.0.0.256', '127.1', '1.127.0.0.1',
      '::ffff:127.0.0.1', '',
    ]) {
      expect(isLoopbackHost(host), host).toBe(false)
    }
    expect(isLoopbackHost(undefined)).toBe(false)
    expect(isLoopbackHost(null)).toBe(false)
  })

  it('agrees with hostOf on URLs', () => {
    expect(isLoopbackHost(hostOf('http://localhost:11434'))).toBe(true)
    expect(isLoopbackHost(hostOf('http://[::1]:1234'))).toBe(true)
    expect(isLoopbackHost(hostOf('http://127.1:8000'))).toBe(true)
    expect(isLoopbackHost(hostOf('http://0.0.0.0:11434'))).toBe(false)
    expect(isLoopbackHost(hostOf('http://192.168.1.2:1234'))).toBe(false)
    expect(isLoopbackHost(hostOf('garbage'))).toBe(false)
  })
})
