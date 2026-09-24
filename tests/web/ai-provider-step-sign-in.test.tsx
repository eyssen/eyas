// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A7 — the setup wizard's AI provider step offers the EYAS sign-in for a
// detected Grok or Kimi CLI (EYAS runs them in its own home, so the host
// login no longer counts), and never for Claude Code.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ providers: [] as any[] }))
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(async (path: string) => {
      if (path === '/model/providers') return { providers: h.providers }
      const id = /\/model\/providers\/([^/]+)\/sign-in/.exec(path)?.[1]
      return { providerId: id, signedIn: false, method: null, apiKeySupported: id === 'grok-cli', apiKeyStored: false, session: null }
    }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import { AiProviderStep } from '@/pages/setup/ai-provider-step'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/pages/setup/locales/en.json'

const cli = (id: string) => ({ id, name: id, kind: 'cli', enabled: true, active: true, hasApiKey: null, modelCount: 1 })

describe('AI provider step — EYAS sign-in for Grok/Kimi', () => {
  beforeEach(() => { useLanguageStore.getState().setLang('en') })
  afterEach(() => cleanup())

  it('a detected Grok CLI shows the sign-in card and the corrected hint (positive)', async () => {
    h.providers = [cli('grok-cli')]
    render(<AiProviderStep onComplete={async () => {}} isLast={false} />)
    expect(await screen.findByTestId('cli-sign-in-grok-cli')).toBeTruthy()
    expect(screen.getByText(en['aiProvider.detectedHint.grok'])).toBeTruthy()
    expect(en['aiProvider.detectedHint.grok']).not.toMatch(/no API key needed/)
  })

  it('several detected CLIs: a card for Grok and Kimi, none for Claude Code (negative)', async () => {
    h.providers = [cli('claude-code'), cli('grok-cli'), cli('kimi-cli')]
    render(<AiProviderStep onComplete={async () => {}} isLast={false} />)
    expect(await screen.findByTestId('cli-sign-in-grok-cli')).toBeTruthy()
    expect(screen.getByTestId('cli-sign-in-kimi-cli')).toBeTruthy()
    expect(screen.queryByTestId('cli-sign-in-claude-code')).toBeNull()
  })

  it('a Claude-Code-only install shows no sign-in card (negative)', async () => {
    h.providers = [cli('claude-code')]
    render(<AiProviderStep onComplete={async () => {}} isLast={false} />)
    expect(await screen.findByText(en['aiProvider.detectedHint.claude'])).toBeTruthy()
    expect(screen.queryByTestId(/cli-sign-in-/)).toBeNull()
  })
})
