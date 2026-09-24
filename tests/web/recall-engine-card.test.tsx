// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// J13 — the Memory page's read-only "Recall engine" card: the local embedder,
// vector coverage of summaries and facts, the last worker run, the project
// partitions, the capture switches and the recall settings, all from
// GET /memory/engine. Every key exists in all six languages.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/api', () => ({
  api: { get: h.get },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message) }
  },
}))

import RecallEngineCard, { type MemoryEngineStatus } from '@/pages/memory/recall-engine-card'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/pages/memory/locales/en.json'
import hu from '@/pages/memory/locales/hu.json'
import de from '@/pages/memory/locales/de.json'
import es from '@/pages/memory/locales/es.json'
import fr from '@/pages/memory/locales/fr.json'
import tlh from '@/pages/memory/locales/tlh.json'

const E = en as Record<string, string>

const STATUS: MemoryEngineStatus = {
  embedder: { modelId: 'multilingual-e5-small@q8/e5-prefix', kind: 'e5' },
  l3: { gists: { embedded: 12, total: 14 }, facts: { embedded: 30, total: 30 }, lastRunAt: Date.UTC(2026, 8, 20, 10, 0) },
  partitions: { projects: 3, projectTypes: 1 },
  capture: { l0Enabled: true, toolResults: false, thinking: true },
  recall: { includeSecrets: false, indexBudgetChars: 2_400 },
}

/** The value cell of the row whose label is `label`. */
function valueOf(label: string): string {
  const row = screen.getByText(label).parentElement!
  return row.querySelector('.text-sm')!.textContent ?? ''
}

describe('RecallEngineCard', () => {
  beforeEach(() => {
    h.get.mockReset()
    useLanguageStore.getState().setLang('en')
  })
  afterEach(() => cleanup())

  it('(+) shows the embedder, coverage, last run, partitions, capture and recall settings', async () => {
    h.get.mockResolvedValue(STATUS)
    render(<RecallEngineCard />)
    await screen.findByText(E['memory.engine.embedderE5'])
    expect(h.get).toHaveBeenCalledWith('/memory/engine')
    expect(screen.getByText('multilingual-e5-small@q8/e5-prefix')).toBeTruthy()
    expect(valueOf(E['memory.engine.gists'])).toBe('12 of 14')
    expect(valueOf(E['memory.engine.facts'])).toBe('30 of 30')
    expect(valueOf(E['memory.engine.lastRun'])).toBe(new Date(STATUS.l3.lastRunAt!).toLocaleString())
    expect(valueOf(E['memory.engine.partitions'])).toBe('projects: 3 · project types: 1')
    expect(valueOf(E['memory.engine.captureRaw'])).toBe('On')
    expect(valueOf(E['memory.engine.captureTools'])).toBe('Off')
    expect(valueOf(E['memory.engine.captureThinking'])).toBe('On')
    expect(valueOf(E['memory.engine.includeSecrets'])).toBe('Off')
    expect(valueOf(E['memory.engine.indexBudget'])).toBe('2400 characters')
  })

  it('(+) the hashed fallback embedder and a worker that has not run since start', async () => {
    h.get.mockResolvedValue({
      ...STATUS,
      embedder: { modelId: 'stem5-fnv-384', kind: 'hash' },
      l3: { ...STATUS.l3, lastRunAt: null },
    })
    render(<RecallEngineCard />)
    await screen.findByText(E['memory.engine.embedderHash'])
    expect(valueOf(E['memory.engine.lastRun'])).toBe(E['memory.engine.never'])
  })

  it('(−) no embedder reads as off', async () => {
    h.get.mockResolvedValue({ ...STATUS, embedder: null })
    render(<RecallEngineCard />)
    await screen.findByText(E['memory.engine.gists'])
    expect(valueOf(E['memory.engine.embedder'])).toBe(E['memory.engine.off'])
  })

  it('(−) a failed load says so and shows no values', async () => {
    h.get.mockRejectedValue(new Error('boom'))
    render(<RecallEngineCard />)
    expect((await screen.findByRole('alert')).textContent).toBe(E['memory.engine.loadFailed'])
    expect(screen.queryByText(E['memory.engine.gists'])).toBeNull()
  })

  it('(+) renders in Hungarian from the hu bundle', async () => {
    useLanguageStore.getState().setLang('hu')
    h.get.mockResolvedValue(STATUS)
    render(<RecallEngineCard />)
    await screen.findByText((hu as Record<string, string>)['memory.engine.heading'])
    expect(valueOf((hu as Record<string, string>)['memory.engine.gists'])).toBe('12 / 14')
  })
})

describe('memory.engine.* locale parity', () => {
  const bundles = { en, hu, de, es, fr, tlh } as Record<string, Record<string, string>>
  const engineKeys = (b: Record<string, string>) => Object.keys(b).filter((k) => k.startsWith('memory.engine.')).sort()

  it('(+) all six languages carry the same keys, each with the same placeholders', () => {
    const want = engineKeys(bundles.en)
    expect(want.length).toBeGreaterThan(0)
    const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort()
    for (const [lang, b] of Object.entries(bundles)) {
      expect(engineKeys(b), lang).toEqual(want)
      for (const k of want) {
        expect(b[k], `${lang} ${k}`).toBeTruthy()
        expect(placeholders(b[k]), `${lang} ${k}`).toEqual(placeholders(bundles.en[k]))
      }
    }
  })

  it('(−) every key the card uses exists in English (no raw key reaches the UI)', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src/web/src/pages/memory/recall-engine-card.tsx'), 'utf8')
    const used = [...src.matchAll(/t\('(memory\.engine\.[A-Za-z0-9]+)'/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(0)
    for (const k of used) expect(E[k], k).toBeTruthy()
  })
})
