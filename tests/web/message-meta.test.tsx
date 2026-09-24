// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G10 — the line under a reply, the same for every provider: one outcome
// badge (none for a completed turn), tokens and cost with where the cost came
// from — a provider that reported no usage reads "not reported", never $0 —
// and the approvals the turn asked for.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const nav = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => nav.navigate }))

import { MessageMeta, OUTCOME_KEY, turnMetaView, usageCaption } from '@/pages/conversations/components/message-meta'
import { t } from '@/pages/conversations/i18n'
import { useLanguageStore } from '@/stores/language-store'

function meta(extra: Record<string, unknown>) {
  return {
    outcome: 'completed',
    stopReason: 'end',
    usage: { inputTokens: 1200, outputTokens: 340, costUsd: 0.0123 },
    costSource: 'provider',
    ...extra,
  }
}

describe('<MessageMeta>', () => {
  beforeEach(() => {
    useLanguageStore.getState().setLang('en')
    nav.navigate.mockReset()
  })
  afterEach(() => cleanup())

  it('(+) max_turns shows the turn-limit badge', () => {
    render(<MessageMeta provider="claude-code" model="m1" turnMeta={meta({ outcome: 'max_turns', stopReason: 'max_turns' })} />)
    const badge = screen.getByTestId('turn-outcome')
    expect(badge.textContent).toBe('Turn limit reached')
    expect(badge.getAttribute('data-outcome')).toBe('max_turns')
    expect(badge.getAttribute('title')).toContain('the answer so far is kept')
  })

  it('(+) every outcome but completed has a badge text in every language', () => {
    for (const lang of ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const) {
      useLanguageStore.getState().setLang(lang)
      for (const key of Object.values(OUTCOME_KEY)) expect(t(key), `${lang}/${key}`).not.toBe(key)
    }
  })

  it('(+) a failed turn\'s badge names how it failed, from the stored error kind', () => {
    render(<MessageMeta provider="grok-cli" model="m1" turnMeta={meta({ outcome: 'failed', errorKind: 'rate-limit' })} />)
    const badge = screen.getByTestId('turn-outcome')
    expect(badge.textContent).toBe('Failed')
    expect(badge.getAttribute('title')).toContain(t('conversations.errors.rateLimit'))
  })

  it('(−) a completed turn shows no outcome badge', () => {
    render(<MessageMeta provider="anthropic" model="m1" turnMeta={meta({})} />)
    expect(screen.queryByTestId('turn-outcome')).toBeNull()
  })

  it('(+) provider-reported cost: tokens in/out and the price, sourced in the tooltip', () => {
    render(<MessageMeta provider="anthropic" model="m1" turnMeta={meta({ usage: { inputTokens: 1000, outputTokens: 340, cacheReadTokens: 200, costUsd: 0.0123 } })} />)
    const usage = screen.getByTestId('turn-usage')
    expect(usage.textContent).toBe(`${(1200).toLocaleString()} in · 340 out · $0.0123`)
    expect(usage.getAttribute('title')).toBe('Cost as reported by the provider')
  })

  it('(+) an estimated cost is marked as an estimate', () => {
    render(<MessageMeta provider="openai" model="m1" turnMeta={meta({ costSource: 'estimate', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.5 } })} />)
    const usage = screen.getByTestId('turn-usage')
    expect(usage.textContent).toContain('~$0.50')
    expect(usage.getAttribute('title')).toContain('estimated by EYAS')
  })

  it('(−) costSource unknown shows "not reported", never $0', () => {
    render(<MessageMeta provider="grok-cli" model="m1" turnMeta={meta({ costSource: 'unknown', usage: { inputTokens: 0, outputTokens: 0, reported: false } })} />)
    const usage = screen.getByTestId('turn-usage')
    expect(usage.textContent).toBe('Usage not reported')
    expect(usage.textContent).not.toContain('$')
    expect(usage.getAttribute('title')).toContain('did not report its usage')
  })

  it('(−) usage reported:false wins even over a stray cost figure', () => {
    const view = turnMetaView(meta({ costSource: 'provider', usage: { inputTokens: 0, outputTokens: 0, reported: false, costUsd: 0 } }))
    expect(view.usage?.costSource).toBe('unknown')
    expect(usageCaption(view.usage!).text).not.toContain('$0')
  })

  it('(+) approvals the turn asked for link to the approval queue', () => {
    render(<MessageMeta provider="anthropic" model="m1" turnMeta={meta({ approvals: 2 })} />)
    const link = screen.getByTestId('turn-approvals')
    expect(link.textContent).toContain('Approvals requested: 2')
    fireEvent.click(link)
    expect(nav.navigate).toHaveBeenCalledWith({ to: '/autonomy' })
  })

  it('(−) an old reply without turn metadata shows only who answered it; malformed fields are ignored', () => {
    render(<MessageMeta provider="anthropic" model="m1" turnMeta={null} />)
    expect(screen.getByTestId('answered-by')).toBeTruthy()
    expect(screen.queryByTestId('turn-outcome')).toBeNull()
    expect(screen.queryByTestId('turn-usage')).toBeNull()
    expect(screen.queryByTestId('turn-approvals')).toBeNull()
    expect(turnMetaView({ outcome: 'exploded', usage: 'lots', approvals: -3 })).toEqual({ outcome: null, usage: null, approvals: 0, errorKind: null })
  })
})
