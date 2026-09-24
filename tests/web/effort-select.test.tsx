// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E5 — THE effort select: only the rungs the target model offers, a list that
// follows a model change, Auto that says what it means there, a stored rung
// the model lacks shown as "level → effective", Auto only for an unknown
// model; and the per-turn effort chip under a reply.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EffortSelect } from '@/components/effort-select'
import { TurnEffortChip } from '@/pages/conversations/components/turn-effort-chip'
import { effortOptionsFor, unknownEffortOptions, type EffortOptions } from '@/lib/effort-options'
import { useLanguageStore } from '@/stores/language-store'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'

const registry = createReasoningRegistry({ getDiscovered: () => null })
const pinned = (providerId: string, modelId: string, name = modelId): EffortOptions =>
  effortOptionsFor(registry.get(providerId, modelId), { providerId, modelId, name })

function optionTexts(): string[] {
  return Array.from((screen.getByTestId('effort-select') as HTMLSelectElement).options).map((o) => o.textContent ?? '')
}
function optionValues(): string[] {
  return Array.from((screen.getByTestId('effort-select') as HTMLSelectElement).options).map((o) => o.value)
}

beforeEach(() => useLanguageStore.getState().setLang('en'))
afterEach(() => cleanup())

describe('EffortSelect', () => {
  it('opus-5-5 lists its rungs with no Off/None, and its default on Auto', () => {
    render(<EffortSelect value={null} options={pinned('anthropic', 'claude-opus-5-5')} onChange={() => {}} />)
    expect(optionValues()).toEqual(['auto', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(optionTexts()).not.toContain('None')
    expect(optionTexts()).not.toContain('Off')
    expect(optionTexts()[0]).toBe('Auto · model default (Medium)')
  })

  it('offers none / minimal / xhigh where the model supports them', () => {
    render(<EffortSelect value={null} options={pinned('openai', 'gpt-5')} onChange={() => {}} />)
    expect(optionValues()).toContain('minimal')
    cleanup()
    render(<EffortSelect value={null} options={pinned('openai', 'gpt-5.5')} onChange={() => {}} />)
    expect(optionValues()).toEqual(['auto', 'none', 'low', 'medium', 'high', 'xhigh'])
  })

  it('switching the model re-renders the list', () => {
    const { rerender } = render(<EffortSelect value={null} options={pinned('anthropic', 'claude-opus-4-8')} onChange={() => {}} />)
    expect(optionValues()).toContain('xhigh')
    rerender(<EffortSelect value={null} options={pinned('anthropic', 'claude-opus-4-6')} onChange={() => {}} />)
    expect(optionValues()).not.toContain('xhigh')
  })

  it('Auto emits null, a rung emits the rung', () => {
    const onChange = vi.fn()
    render(<EffortSelect value="high" options={pinned('anthropic', 'claude-opus-4-8')} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('effort-select'), { target: { value: 'auto' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
    fireEvent.change(screen.getByTestId('effort-select'), { target: { value: 'xhigh' } })
    expect(onChange).toHaveBeenLastCalledWith('xhigh')
  })

  it("Deep shows 'Auto · Max (Deep)'", () => {
    render(<EffortSelect value={null} options={pinned('anthropic', 'claude-opus-4-8')} inherited={{ level: 'max', source: 'deep' }} onChange={() => {}} />)
    expect(optionTexts()[0]).toBe('Auto · Max (Deep)')
  })

  it("an unsupported stored value shows '→ effective' and stays selected (not rewritten)", () => {
    const onChange = vi.fn()
    render(<EffortSelect value="xhigh" options={pinned('anthropic', 'claude-opus-4-6', 'Opus 4.6')} onChange={onChange} />)
    const select = screen.getByTestId('effort-select') as HTMLSelectElement
    expect(select.value).toBe('xhigh')
    expect(optionTexts()).toContain('Extra high → High (Opus 4.6 does not offer Extra high)')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('an unknown model shows only Auto, with a hint (form variant)', () => {
    render(<EffortSelect variant="form" value={null} options={unknownEffortOptions('mystery-1')} onChange={() => {}} />)
    expect(optionValues()).toEqual(['auto'])
    expect(screen.getByText(/mystery-1/)).toBeInTheDocument()
  })

  it('an on/off model reads Off / On', () => {
    render(<EffortSelect value={null} options={pinned('kimi', 'kimi-k2.6')} onChange={() => {}} />)
    expect(optionTexts().slice(1)).toEqual(['Off', 'On'])
  })

  it('while options load, only Auto and the stored rung are listed (negative)', () => {
    render(<EffortSelect value="high" options={null} onChange={() => {}} />)
    expect(optionValues()).toEqual(['auto', 'high'])
  })

  it('the form variant renders the caller hint under the select; inline keeps it in the tooltip', () => {
    render(<EffortSelect variant="form" value={null} options={pinned('anthropic', 'claude-opus-4-8')} hint="Tier default" onChange={() => {}} />)
    expect(screen.getByText('Tier default')).toBeInTheDocument()
    cleanup()
    render(<EffortSelect value={null} options={pinned('anthropic', 'claude-opus-4-8')} hint="Tier default" onChange={() => {}} />)
    expect(screen.queryByText('Tier default')).toBeNull()
    expect(screen.getByTestId('effort-select').getAttribute('title')).toContain('Tier default')
  })
})

describe('TurnEffortChip', () => {
  it('shows the effective level with who set it', () => {
    render(<TurnEffortChip turnMeta={{ effort: { requested: 'high', effective: 'high', source: 'agent', clamped: false } }} />)
    const chip = screen.getByTestId('turn-effort')
    expect(chip).toHaveTextContent('Effort: High')
    expect(chip.getAttribute('title')).toContain('Set by: colleague')
  })

  it('shows the adjustment when the model did not offer the level', () => {
    render(<TurnEffortChip turnMeta={{ effort: { requested: 'max', effective: 'xhigh', source: 'deep', clamped: true } }} />)
    expect(screen.getByTestId('turn-effort')).toHaveTextContent('Effort: Max → Extra high')
  })

  it('renders nothing without an effort, or when nothing was asked or sent (negative)', () => {
    const { container } = render(<>
      <TurnEffortChip turnMeta={null} />
      <TurnEffortChip turnMeta={{ effort: { requested: 'auto', effective: 'auto' } }} />
      <TurnEffortChip turnMeta={{ effort: { requested: 'bogus', effective: 'high' } }} />
    </>)
    expect(container.textContent).toBe('')
  })
})
