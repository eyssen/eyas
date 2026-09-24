// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G10 — stream-error.tsx is the only renderer of a failed chat turn: a coded
// failure reads as conversations.errors.<code>, anything else as its kind's
// generic message (an exhaustive map), an unknown kind as 'other'. The raw
// provider text is only the collapsed detail. (Ports the A6 cliIsolation and
// H3/E3 coded-body cases of the folded stream-error-format.ts.)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const nav = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => nav.navigate }))

import { MODEL_ERROR_KINDS } from '../../src/shared/classify-model-error'
import {
  KIND_KEY,
  StreamError,
  chatErrorText,
  errorViewFromBody,
  formatErrorBody,
  kindKey,
} from '@/pages/conversations/components/stream-error'
import { t } from '@/pages/conversations/i18n'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/pages/conversations/locales/en.json'
import { primeProviderCatalog } from './provider-catalog-fixture'

// Provider names come from the served catalog (G13), primed into the shared cache.
beforeEach(primeProviderCatalog)

const LANGS = ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const

describe('KIND_KEY — one generic message per failure kind', () => {
  afterEach(() => useLanguageStore.getState().setLang('en'))

  it('(+) every ModelErrorKind, including isolation, has a key with text in every language', () => {
    expect(Object.keys(KIND_KEY).sort()).toEqual([...MODEL_ERROR_KINDS].sort())
    expect(KIND_KEY.isolation).toBe('conversations.errors.isolation')
    for (const lang of LANGS) {
      useLanguageStore.getState().setLang(lang)
      for (const kind of MODEL_ERROR_KINDS) {
        const text = t(KIND_KEY[kind])
        expect(text, `${lang}/${kind}`).not.toBe(KIND_KEY[kind])
        expect(text.trim().length, `${lang}/${kind}`).toBeGreaterThan(0)
      }
    }
  })

  it('(−) an unknown or missing kind reads as other', () => {
    expect(kindKey('martian')).toBe(KIND_KEY.other)
    expect(kindKey(undefined)).toBe(KIND_KEY.other)
    expect(kindKey('toString')).toBe(KIND_KEY.other)
  })
})

describe('chatErrorText', () => {
  beforeEach(() => useLanguageStore.getState().setLang('en'))
  afterEach(() => useLanguageStore.getState().setLang('en'))

  it('(+) a coded failure reads as its code key with params (provider brand name)', () => {
    const text = chatErrorText({ source: 'stream', kind: 'auth', code: 'cliSignIn', params: { provider: 'kimi-cli' }, detail: 'raw' })
    expect(text).toContain('Kimi Code CLI is not signed in for EYAS')
    expect(text).not.toContain('raw')
  })

  it('(−) a code missing from the bundle falls back to the kind message, never the raw text', () => {
    const text = chatErrorText({ source: 'stream', kind: 'overload', code: 'brandNewCode', detail: 'HTTP 529 upstream' })
    expect(text).toBe(t('conversations.errors.overload'))
    expect(text).not.toContain('529')
  })

  it('(−) a code shaped like a key path or a reserved key is not looked up', () => {
    expect(chatErrorText({ source: 'stream', kind: 'other', code: 'cliIsolation.check.hooks' })).toBe(t('conversations.errors.other'))
    expect(chatErrorText({ source: 'stream', kind: 'other', code: 'showDetails' })).toBe(t('conversations.errors.other'))
  })

  it('(+) HTTP and connection failures have their own localized message', () => {
    expect(chatErrorText({ source: 'http', status: 502, detail: 'Bad Gateway' })).toBe('The server did not accept the message (HTTP 502).')
    expect(chatErrorText({ source: 'connection', detail: 'Failed to fetch' })).toContain('The connection to the server broke off')
  })

  it('cliIsolation: the provider name and every failed check, localized (positive)', () => {
    const text = chatErrorText({
      source: 'stream', kind: 'isolation', code: 'cliIsolation',
      params: { provider: 'grok-cli', checks: 'mcpServers,ungovernedTool' },
    })
    expect(text).toContain('Grok CLI was stopped')
    expect(text).toContain("MCP servers other than EYAS's")
    expect(text).toContain("a tool that ran without EYAS's approval")
    expect(text).not.toContain('mcpServers')
  })

  it('cliIsolation in another language uses that language', () => {
    useLanguageStore.getState().setLang('hu')
    const text = chatErrorText({ source: 'stream', kind: 'isolation', code: 'cliIsolation', params: { provider: 'kimi-cli', checks: 'memory' } })
    expect(text).toContain('Kimi Code CLI')
    expect(text).toContain('a CLI saját memóriája')
    useLanguageStore.getState().setLang('de')
    expect(chatErrorText({ source: 'stream', kind: 'isolation', code: 'cliIsolation', params: { provider: 'claude-code', checks: 'initMissing' } }))
      .toContain('die CLI hat ihre Startkonfiguration nicht gemeldet')
  })

  it('cliIsolation: an unknown check id is shown as is; no checks at all reads as unverified', () => {
    expect(chatErrorText({ source: 'stream', kind: 'isolation', code: 'cliIsolation', params: { provider: 'grok-cli', checks: 'brandNewCheck' } })).toContain('brandNewCheck')
    expect(chatErrorText({ source: 'stream', kind: 'isolation', code: 'cliIsolation', params: { provider: 'grok-cli' } })).toContain('the check could not run')
  })

  it('cliSandboxUnavailable and the binding codes are translated in every language, never the raw code', () => {
    for (const lang of LANGS) {
      useLanguageStore.getState().setLang(lang)
      for (const code of ['cliSandboxUnavailable', 'model_binding_unavailable', 'no_model_configured', 'binding_inherit_needs_agent']) {
        const text = chatErrorText({ source: 'stream', kind: 'invalid-request', code, params: { provider: 'grok-cli', model: 'alpha' }, detail: 'raw english' })
        expect(text, `${lang}/${code}`).not.toContain('raw english')
        expect(text, `${lang}/${code}`).not.toContain(code)
      }
    }
  })
})

describe('errorViewFromBody / formatErrorBody — a coded refusal (H3/E3)', () => {
  beforeEach(() => useLanguageStore.getState().setLang('en'))
  afterEach(() => useLanguageStore.getState().setLang('en'))

  it('model_binding_unavailable names the provider and the model, in the user\'s language (positive)', () => {
    const body = { error: 'The model this conversation uses (grok-cli / grok-4.6) is not available — choose another model', code: 'model_binding_unavailable', providerId: 'grok-cli', modelId: 'grok-4.6' }
    expect(formatErrorBody(body, 'Bad Request')).toContain('Grok CLI / grok-4.6')
    useLanguageStore.getState().setLang('hu')
    const hu = formatErrorBody(body, 'Bad Request')
    expect(hu).toContain('Grok CLI / grok-4.6')
    expect(hu).toContain('nem érhető el')
    expect(hu).not.toContain('choose another model')
  })

  it('EFFORT_UNSUPPORTED lists the rungs the model accepts; no rungs reads as Auto-only', () => {
    expect(formatErrorBody({ error: 'x', code: 'EFFORT_UNSUPPORTED', modelId: 'gpt-5.5', levels: ['low', 'medium', 'high', 'xhigh'] }, 'x'))
      .toBe('gpt-5.5 does not offer this effort level. Choose Auto or one of: low, medium, high, xhigh.')
    expect(formatErrorBody({ error: 'x', code: 'EFFORT_UNSUPPORTED', modelId: 'm', levels: [] }, 'x'))
      .toBe('m has no reasoning-effort control; only Auto can be set.')
  })

  it('(−) an unknown code, no code or no body keeps the server text for a toast, with no English prefix', () => {
    expect(formatErrorBody({ error: 'boom', code: 'nope' }, 'x')).toBe('boom')
    expect(formatErrorBody({ error: 'boom' }, 'x')).toBe('boom')
    expect(formatErrorBody(null, 'Bad Request')).toBe('Bad Request')
  })

  it('(+) the view keeps the status and the raw text as detail', () => {
    expect(errorViewFromBody({ error: 'busy', code: 'GodModeBusyError' }, 409, 'Conflict'))
      .toEqual({ source: 'http', status: 409, detail: 'busy', code: 'GodModeBusyError' })
  })
})

describe('<StreamError>', () => {
  beforeEach(() => {
    useLanguageStore.getState().setLang('en')
    nav.navigate.mockReset()
  })
  afterEach(() => cleanup())

  it('(+) the raw detail is collapsed until asked for; the partial-answer note shows', () => {
    render(<StreamError error={{ source: 'stream', kind: 'timeout', detail: 'ETIMEDOUT after 120000ms', partialSaved: true }} />)
    expect(screen.getByRole('alert').textContent).toContain(t('conversations.errors.timeout'))
    expect(screen.queryByText('ETIMEDOUT after 120000ms')).toBeNull()
    expect(screen.getByTestId('stream-error-partial').textContent).toBe(en['conversations.errors.partialSaved'])
    fireEvent.click(screen.getByRole('button', { name: /Show details/ }))
    expect(screen.getByText('ETIMEDOUT after 120000ms')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Hide details/ })).toBeTruthy()
  })

  it('(+) a provider-side failure links to the provider settings', () => {
    render(<StreamError error={{ source: 'stream', kind: 'auth', code: 'cliSignIn', params: { provider: 'grok-cli' } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open provider settings' }))
    expect(nav.navigate).toHaveBeenCalledWith({ to: '/providers' })
  })

  it('(−) no detail toggle without a detail, no settings link for a network failure, no partial note when nothing was saved', () => {
    render(<StreamError error={{ source: 'stream', kind: 'network', partialSaved: false }} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByTestId('stream-error-partial')).toBeNull()
  })
})
