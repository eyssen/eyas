// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { extractEntities, extractKeyValues, MAX_ENTITIES } from '@modules/memory/v2/extract/entities'

const names = (text: string, type: string) => extractEntities(text).filter((e) => e.type === type).map((e) => e.name)

describe('extractEntities', () => {
  it('finds ISO, Hungarian dotted and day-first dates', () => {
    expect(names('Meeting on 2026-09-03 and 2026. 09. 04. also 03.09.2026 at 10:30.', 'date'))
      .toEqual(['2026-09-03', '2026. 09. 04.', '03.09.2026'])
  })
  it('finds @mentions without trailing punctuation and never inside e-mail addresses', () => {
    expect(names('Ping @krisz and @eyas-bot. Mail krisz@eyssen.com instead.', 'mention')).toEqual(['krisz', 'eyas-bot'])
  })
  it('finds #tickets with 2–7 digits, not C# or HTML entities', () => {
    expect(names('ticket #1234 and #56, not C# nor &#39; nor #7', 'ticket')).toEqual(['1234', '56'])
  })
  it('turns key: value and key = value lines into kv entities (keys only)', () => {
    const text = 'Deadline: 2026-10-01\nCustomer = Werth Kft\nhttps://example.com/x\n12:30 lunch\n'
    expect(names(text, 'kv')).toEqual(['Deadline', 'Customer'])
    expect(extractKeyValues(text)).toEqual([{ key: 'Deadline', value: '2026-10-01' }, { key: 'Customer', value: 'Werth Kft' }])
  })
  it('finds backticked, camelCase, snake_case identifiers and file names once each', () => {
    const got = names('call `runExtraction` in extractor.ts via tool_executor and camelCase; runExtraction again', 'code')
    expect(got).toEqual(expect.arrayContaining(['runExtraction', 'extractor.ts', 'tool_executor', 'camelCase']))
    expect(got.filter((n) => n === 'runExtraction')).toHaveLength(1)
  })
  it('finds capitalised multi-word phrases, dropping leading stop-words and single words', () => {
    expect(names('The Kubernetes Ingress broke for Werth Kft in Budapest yesterday. A szállítási cím Werth Kft.', 'proper'))
      .toEqual(['Kubernetes Ingress', 'Werth Kft'])
  })
  it('strips every quotation style this product ships, at both word edges', () => {
    // Written with \u escapes on purpose: the literal characters were silently
    // mangled into straight quotes THREE times while transcribing this file, and
    // every other assertion here uses straight quotes or none, so nothing could
    // see the damage. U+201C closes a German/Hungarian quotation and opens an
    // English one, which is why it belongs in both character classes.
    const quoted = (open: string, close: string): string[] =>
      extractEntities(`He said ${open}Kubernetes Ingress${close} loudly.`).filter((e) => e.type === 'proper').map((e) => e.name)
    expect(quoted('\u201C', '\u201D')).toEqual(['Kubernetes Ingress'])   // English
    expect(quoted('\u201E', '\u201C')).toEqual(['Kubernetes Ingress'])   // German/Hungarian
    expect(quoted('\u00AB', '\u00BB')).toEqual(['Kubernetes Ingress'])   // French
    expect(quoted('"', '"')).toEqual(['Kubernetes Ingress'])
  })
  it('caps the list and returns nothing for empty text', () => {
    const many = Array.from({ length: 60 }, (_, i) => `#${1000 + i}`).join(' ')
    expect(extractEntities(many)).toHaveLength(MAX_ENTITIES)
    expect(extractEntities('')).toEqual([])
  })
})
