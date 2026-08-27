// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it } from 'vitest'
import {
  formatAddressList,
  isValidAddress,
  parseAddress,
  parseAddressList,
} from '../../../../../src/modules/communication/providers/imap-smtp/address-parser.js'

describe('address-parser', () => {
  it('parses a bare address', () => {
    expect(parseAddress('jane@example.com')).toEqual({ address: 'jane@example.com' })
  })

  it('parses a display-name with angle brackets', () => {
    expect(parseAddress('"John Doe" <john@example.com>')).toEqual({
      name: 'John Doe',
      address: 'john@example.com',
    })
  })

  it('parses a comma-separated list', () => {
    const list = parseAddressList('Alice <a@ex.com>, b@ex.com, "C" <c@ex.com>')
    expect(list.length).toBe(3)
    expect(list[0]?.address).toBe('a@ex.com')
    expect(list[1]?.address).toBe('b@ex.com')
    expect(list[2]?.name).toBe('C')
  })

  it('ignores parenthesized comments', () => {
    expect(parseAddress('john@example.com (John Doe)')).toEqual({
      address: 'john@example.com',
    })
  })

  it('handles quoted local-parts', () => {
    // We unquote during parse; the domain is preserved verbatim.
    const addr = parseAddress('"weird.name"@example.com')
    expect(addr?.address?.endsWith('@example.com')).toBe(true)
  })

  it('handles group syntax', () => {
    const list = parseAddressList('team:alice@x.com, bob@x.com;')
    expect(list.length).toBe(1)
    expect(list[0]?.address).toBe('alice@x.com')
  })

  it('rejects obviously malformed addresses', () => {
    expect(parseAddress('no-at-sign')).toBeNull()
    expect(parseAddress('@no-local.com')).toBeNull()
    expect(parseAddress('local@')).toBeNull()
    expect(parseAddress('')).toBeNull()
    expect(parseAddress(null)).toBeNull()
    expect(parseAddress(undefined)).toBeNull()
  })

  it('validates addresses', () => {
    expect(isValidAddress('jane@example.com')).toBe(true)
    expect(isValidAddress('jane@[127.0.0.1]')).toBe(true)
    expect(isValidAddress('jane@localhost')).toBe(false)
    expect(isValidAddress('jane example@example.com')).toBe(false)
    expect(isValidAddress('')).toBe(false)
    expect(isValidAddress('a'.repeat(300) + '@example.com')).toBe(false)
  })

  it('round-trips through formatAddressList', () => {
    const input = '"John Doe" <john@example.com>, jane@example.com'
    const parsed = parseAddressList(input)
    const back = formatAddressList(parsed)
    const reparsed = parseAddressList(back)
    expect(reparsed.length).toBe(parsed.length)
    for (let i = 0; i < parsed.length; i++) {
      expect(reparsed[i]?.address).toBe(parsed[i]?.address)
    }
  })

  it('quotes names with special characters', () => {
    const formatted = formatAddressList([{ name: 'Doe, John', address: 'j@x.com' }])
    expect(formatted.startsWith('"Doe, John"')).toBe(true)
  })

  it('handles empty input gracefully', () => {
    expect(parseAddressList('')).toEqual([])
    expect(parseAddressList(null)).toEqual([])
    expect(parseAddressList(undefined)).toEqual([])
  })
})
