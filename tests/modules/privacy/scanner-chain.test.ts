// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import pino from 'pino'
import { createLocalBus } from '@core/bus/local-bus'
import { createMemoryDb } from '../../helpers/test-db'
import { createPrivacyFixture } from '../../helpers/privacy-service'
import { createScannerChain } from '@modules/privacy/scanner-chain'
import { createRegexScanner } from '@modules/privacy/scanners/regex-scanner'
import { createCustomScanner } from '@modules/privacy/scanners/custom-scanner'
import type { PiiMatch, PiiScanner } from '@modules/privacy/types'

const silent = pino({ level: 'silent' })

function makeChain() {
  const chain = createScannerChain()
  chain.addScanner(createRegexScanner())
  chain.addScanner(
    createCustomScanner([{ name: 'internal_project', regex: 'PROJECT-[A-Z]{3}-\\d+', type: 'custom', confidence: 0.9 }], silent),
  )
  return chain
}

const CORPUS = [
  '- Current date: 2026-09-08',
  'Tel.: 06 30 123 4567',
  'IBAN: HU42 1177 3016 1111 1018 0000 0000',
  'mail john.doe@example.com and jane@example.org',
  'task 1281 build 4821937465',
  'Adószám: 12345676-2-42',
  'TAJ: 123 456 788',
  '',
  '   ',
  'Card: 4532 0151 1283 0366',
  'PROJECT-ABC-123 is internal',
  'Számla: 11773016-11111018',
  'Telefon:',
  '030 1234567',
  '+36 30',
  '123 4567',
  'plain prose line',
  'Adóazonosító jel:',
  '8123456786',
  '2026-09-22T14:05:33Z v0.8.29-beta 10.0.1.57',
]

/** Small deterministic PRNG (LCG) so the property run is reproducible. */
function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return s / 2 ** 32
  }
}

function strip(matches: PiiMatch[]) {
  return matches.map(({ type, value, start, end, scanner }) => ({ type, value, start, end, scanner }))
}

describe('ScannerChain v2 — synchronous and line-bounded', () => {
  it('scan() is synchronous', () => {
    const result = makeChain().scan('john.doe@example.com')
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
  })

  it('property: scan(text) equals the union of per-line scans with shifted offsets', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = prng(seed)
      const lines = Array.from({ length: 1 + Math.floor(rand() * 30) }, () => CORPUS[Math.floor(rand() * CORPUS.length)])
      const text = lines.join('\n')

      const expected: PiiMatch[] = []
      let offset = 0
      for (const line of lines) {
        for (const m of makeChain().scan(line)) expected.push({ ...m, start: m.start + offset, end: m.end + offset })
        offset += line.length + 1
      }

      const actual = makeChain().scan(text)
      expect(strip(actual), `seed ${seed}`).toEqual(strip(expected))
      for (const m of actual) expect(text.slice(m.start, m.end)).toBe(m.value)
    }
  })

  it('does not match a phone number split by a line break', () => {
    const chain = makeChain()
    expect(chain.scan('+36 30\n123 4567')).toEqual([])
    expect(chain.scan('Telefon:\n030 1234567')).toEqual([])
    // Same digits on one line are a phone.
    expect(chain.scan('Telefon: 030 1234567').map((m) => m.type)).toEqual(['phone'])
  })

  it('keeps custom patterns line-bounded too', () => {
    const chain = createScannerChain()
    chain.addScanner(createCustomScanner([{ name: 'pair', regex: 'ALPHA\\s+BETA', type: 'custom', confidence: 0.9 }], silent))
    expect(chain.scan('ALPHA\nBETA')).toEqual([])
    expect(chain.scan('ALPHA BETA')).toHaveLength(1)
  })

  it('deduplicates overlapping matches, keeping the higher confidence', () => {
    const chain = createScannerChain()
    chain.addScanner(createRegexScanner())
    chain.addScanner(createCustomScanner([{ name: 'mail', regex: '\\S+@\\S+', type: 'custom', confidence: 0.5 }], silent))
    const matches = chain.scan('write to john.doe@example.com')
    expect(matches.map((m) => m.type)).toEqual(['email'])
  })

  it('drops matches whose offsets do not point at the reported value', () => {
    const liar: PiiScanner = {
      id: 'liar',
      scan: (text) => [
        { type: 'custom', value: 'nope', start: 0, end: 4, confidence: 1, scanner: 'liar' },
        { type: 'custom', value: text.slice(0, 3), start: 0, end: 3, confidence: 1, scanner: 'liar' },
        { type: 'custom', value: 'x', start: 50, end: 51, confidence: 1, scanner: 'liar' },
      ],
    }
    const chain = createScannerChain()
    chain.addScanner(liar)
    expect(chain.scan('abcdef').map((m) => m.value)).toEqual(['abc'])
  })

  it('keeps no counters of its own (the privacy service counts real traffic only)', () => {
    const chain = makeChain() as Record<string, unknown>
    expect(chain.getStats).toBeUndefined()
    expect(chain.resetStats).toBeUndefined()
  })
})

describe('Privacy module — no NER, no model calls', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('scans with the regex and custom scanners only and never fetches a local model', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { privacyModule } = await import('@modules/privacy/index')
    const { createModelGateway } = await import('@modules/model/gateway')
    const { createEgressSlot } = await import('@modules/model/egress')
    const egress = createEgressSlot()
    const gateway = createModelGateway(undefined, { egress })
    gateway.registerProvider({
      id: 'mock', name: 'mock', listModels: async () => [],
      complete: vi.fn(async () => ({ id: 'r', provider: 'mock', model: 'mock', content: [], stopReason: 'end' as const, usage: { inputTokens: 0, outputTokens: 0 } })),
      stream: vi.fn(async function* () {}) as any,
    })
    const ctx = {
      model: gateway, modelEgress: egress, http: new Hono(), bus: createLocalBus(), db: createMemoryDb(),
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    } as any
    await privacyModule.onRegister(ctx)
    await privacyModule.onStart(ctx)

    await ctx.model.complete({
      provider: 'mock',
      system: '- Current date: 2026-09-08',
      messages: [{ role: 'user', content: 'Tel.: 06 30 123 4567, mail john.doe@example.com, see PROJECT-ABC-12' }],
    })
    const calledUrls = fetchSpy.mock.calls.map((c) => String(c[0]))
    expect(calledUrls.filter((u) => u.includes('11434'))).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(Object.keys(ctx.privacy.stats().byScanner).sort()).toEqual(['custom', 'regex'])
    await privacyModule.onStop(ctx)
  })

  it("ignores a legacy 'ner' scanner entry with a warning", () => {
    const fx = createPrivacyFixture([
      'privacy:',
      '  enabled: true',
      '  scanners: [regex, ner]',
      '  rules: []',
      '  custom_patterns: []',
      '  audit: false',
    ].join('\n'))
    try {
      expect(fx.store.current()).toMatchObject({ source: 'yaml', seedError: null })
      expect(fx.logger.warn.mock.calls.some((c: any[]) => String(c[1]).includes("'ner'"))).toBe(true)
      expect(fx.service.redactText('hello', { locality: 'remote' }).text).toBe('hello')
    } finally {
      fx.cleanup()
    }
  })
})
