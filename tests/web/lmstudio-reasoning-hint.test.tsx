// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F9 — the LM Studio panel shows the reasoning default LM Studio reports for
// each model; EYAS never changes it.

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LmStudioReasoningHint } from '@/pages/providers/lmstudio-reasoning-hint'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/pages/providers/locales/en.json'
import hu from '@/pages/providers/locales/hu.json'
import de from '@/pages/providers/locales/de.json'
import es from '@/pages/providers/locales/es.json'
import fr from '@/pages/providers/locales/fr.json'
import tlh from '@/pages/providers/locales/tlh.json'

const KEY = 'providers.panel.lmstudioReasoningHint'

afterEach(() => {
  cleanup()
  useLanguageStore.getState().setLang('en')
})

describe('LmStudioReasoningHint', () => {
  it('(+) shows the reported default per model', () => {
    render(<LmStudioReasoningHint models={[
      { id: 'lmstudio:qwen', name: 'qwen/qwen3-8b', runtimeReasoning: { options: ['off', 'on'], default: 'on' } },
      { id: 'lmstudio:oss', name: 'openai/gpt-oss-20b', runtimeReasoning: { options: ['low', 'medium', 'high'], default: 'medium' } },
    ]} />)
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(items).toHaveLength(2)
    expect(items[0]).toContain('qwen/qwen3-8b')
    expect(items[0]).toContain('default there: on')
    expect(items[1]).toContain('default there: medium')
    expect(items.join(' ')).not.toContain(KEY)
  })

  it('(+) renders in the active language', () => {
    useLanguageStore.getState().setLang('hu')
    render(<LmStudioReasoningHint models={[{ id: 'a', name: 'm', runtimeReasoning: { options: ['on'], default: 'on' } }]} />)
    expect(screen.getByRole('listitem').textContent).toContain('az alapértelmezés: on')
  })

  it('(−) renders nothing when no model reports a default', () => {
    const { container } = render(<LmStudioReasoningHint models={[
      { id: 'a', name: 'a' },
      { id: 'b', name: 'b', runtimeReasoning: { options: ['on'], default: null } },
    ]} />)
    expect(container.textContent).toBe('')
    expect(screen.queryByTestId('lmstudio-reasoning-hint')).toBeNull()
  })
})

describe('providers locale: lmstudioReasoningHint', () => {
  const bundles: Record<string, Record<string, string>> = { en, hu, de, es, fr, tlh }
  for (const [lang, bundle] of Object.entries(bundles)) {
    it(`${lang} defines it with the {{default}} placeholder`, () => {
      expect(bundle[KEY], lang).toBeTruthy()
      expect(bundle[KEY], lang).toContain('{{default}}')
      if (lang !== 'en') expect(bundle[KEY], lang).not.toBe(en[KEY as keyof typeof en])
    })
  }
})
