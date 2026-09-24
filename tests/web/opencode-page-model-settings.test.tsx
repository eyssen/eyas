// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))

vi.mock('@/lib/api', () => ({
  api: { get, post: vi.fn(), put },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message) }
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/components/docs/contextual-help', () => ({
  PageTitle: ({ title }: { title: string }) => <h1>{title}</h1>,
  ContextualHelp: () => null,
}))

import OpencodePage from '@/pages/opencode/opencode-page'

const STATUS = {
  available: true,
  enabled: true,
  checks: [],
  server: { running: true, url: 'http://127.0.0.1:1', version: '1.18.29' },
  pty: { available: true, platform: 'darwin' },
}

const CATALOG = {
  running: true,
  providers: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      models: [
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', variants: ['low', 'high', 'xhigh'].map((id) => ({ id, level: id })) },
      ],
    },
    { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-4o', name: 'GPT-4o', variants: [] }] },
  ],
  defaults: {},
}

function serve(models: unknown, settings: unknown) {
  get.mockImplementation(async (path: string) => {
    if (path === '/opencode/status') return STATUS
    if (path === '/opencode/models') return models
    if (path === '/opencode/settings') return settings
    return {}
  })
}

const modelSelect = () => screen.getByLabelText('Model') as HTMLSelectElement
const variantSelect = () => screen.queryByLabelText('Reasoning variant') as HTMLSelectElement | null

beforeEach(() => {
  get.mockReset()
  put.mockReset()
  put.mockResolvedValue({})
})

describe('OpenCode page — Model and reasoning card', () => {
  it('(+) lists OpenCode\'s models; a model with variants shows the variant select; Save sends both', async () => {
    serve(CATALOG, { model: null, variant: null })
    render(<OpencodePage />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Claude Opus 5.5' })).toBeInTheDocument())
    expect(variantSelect()).toBeNull()

    const opus = screen.getByRole('option', { name: 'Claude Opus 5.5' }) as HTMLOptionElement
    fireEvent.change(modelSelect(), { target: { value: opus.value } })
    const variants = variantSelect()!
    expect(Array.from(variants.options).map((o) => o.value)).toEqual(['', 'low', 'high', 'xhigh'])
    fireEvent.change(variants, { target: { value: 'xhigh' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(put).toHaveBeenCalledWith('/opencode/settings', {
      model: { providerID: 'anthropic', modelID: 'claude-opus-5-5' },
      variant: 'xhigh',
    })
  })

  it('(−) a model without variants hides the variant select', async () => {
    serve(CATALOG, { model: { providerID: 'anthropic', modelID: 'claude-opus-5-5' }, variant: 'high' })
    render(<OpencodePage />)
    await waitFor(() => expect(variantSelect()).not.toBeNull())
    const gpt = screen.getByRole('option', { name: 'GPT-4o' }) as HTMLOptionElement
    fireEvent.change(modelSelect(), { target: { value: gpt.value } })
    expect(variantSelect()).toBeNull()
  })

  it('(−) with no server running it says so and still shows the saved choice', async () => {
    serve({ running: false, providers: [], defaults: {} }, { model: { providerID: 'anthropic', modelID: 'claude-opus-5-5' }, variant: 'high' })
    render(<OpencodePage />)
    await waitFor(() => expect(screen.getByText(/starts with the first OpenCode session or task/)).toBeInTheDocument())
    expect(screen.getByRole('option', { name: 'anthropic/claude-opus-5-5' })).toBeInTheDocument()
    expect(variantSelect()?.value).toBe('high')
    // Nothing changed: nothing to save.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
