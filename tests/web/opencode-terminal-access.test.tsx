// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The OpenCode terminal is the owner's and an admin's (manage OpenCode): the
// conversation top bar shows its toggle only when the server's own CASL check
// says so (GET /opencode/access), and if the server still refuses a terminal
// (403, or the socket's `forbidden` frame) the panel says why in the user's
// language.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/lib/api', () => ({
  api: { get: h.get, post: h.post, patch: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message) }
  },
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { back: vi.fn() } }),
}))
// The bar's neighbours are not under test here.
vi.mock('@/pages/conversations/context-bar', () => ({ ContextBar: () => null }))
vi.mock('@/pages/conversations/composition-panel', () => ({ CompositionPanel: () => null }))
vi.mock('@/pages/conversations/design-attach-menu', () => ({ DesignAttachMenu: () => null }))
vi.mock('@/pages/conversations/components/VoiceScopeBadge', () => ({ VoiceScopeBadge: () => null }))
vi.mock('@/components/docs/contextual-help', () => ({ ContextualHelp: () => null }))
// xterm draws on a canvas jsdom does not have; the panel's text is what is
// under test. xterm is installed only under src/web, so it is mocked there.
vi.mock('../../src/web/node_modules/@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    loadAddon() {}
    open() {}
    write() {}
    onData() {}
    dispose() {}
  },
}))
vi.mock('../../src/web/node_modules/@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('../../src/web/node_modules/@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))

import { ConversationTopBar } from '@/pages/conversations/conversation-top-bar'
import { WebTerminal } from '@/components/terminal/web-terminal'
import { terminalFrameErrorText, terminalOpenErrorText } from '@/components/terminal/terminal-errors'
import { parseOpencodeAccess } from '@/pages/opencode/access'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/pages/opencode/locales/en.json'
import hu from '@/pages/opencode/locales/hu.json'
import de from '@/pages/opencode/locales/de.json'
import es from '@/pages/opencode/locales/es.json'
import fr from '@/pages/opencode/locales/fr.json'
import tlh from '@/pages/opencode/locales/tlh.json'

const LOCALES: Record<string, Record<string, string>> = { en, hu, de, es, fr, tlh }
const TERMINAL_KEYS = ['opencode.terminal.forbidden', 'opencode.terminal.socketError'] as const

function serveAccess(access: unknown) {
  h.get.mockImplementation(async (path: string) => {
    if (path === '/opencode/access') {
      if (access instanceof Error) throw access
      return access
    }
    if (path === '/model/models') return { models: [] }
    return {}
  })
}

function renderBar() {
  render(
    <ConversationTopBar
      conversationId="c1" title="T" status="idle" priority="normal"
      providerId={null} modelId={null} modelBinding="pinned"
      effectiveBinding={null} autoRoutingEnabled agentId={null}
      tokensUsed={0} contextWindow={0}
      onBindingChange={vi.fn()} onTitleChange={vi.fn()} onUpdate={vi.fn()}
      onToggleTerminal={vi.fn()}
    />,
  )
}

beforeEach(() => {
  useLanguageStore.getState().setLang('en')
  h.get.mockReset()
  h.post.mockReset()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('conversation top bar — the OpenCode terminal toggle', () => {
  it('(+) is shown when the server says the user may open terminals (manage OpenCode)', async () => {
    serveAccess({ terminal: true, settings: true })
    renderBar()
    await waitFor(() => expect(screen.getByTitle('OpenCode terminal')).toBeInTheDocument())
    expect(h.get).toHaveBeenCalledWith('/opencode/access')
  })

  /** Renders the bar and waits until the access answer has been applied. */
  async function renderSettled() {
    renderBar()
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('/opencode/access'))
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  }

  it('(−) is hidden for a user the server refuses terminals (a `user`: read only)', async () => {
    serveAccess({ terminal: false, settings: false })
    await renderSettled()
    expect(screen.queryByTitle('OpenCode terminal')).toBeNull()
  })

  it('(−) is hidden when the answer is an error (no read right: 403; the module not loaded: 404)', async () => {
    for (const status of [403, 404]) {
      serveAccess(Object.assign(new Error('refused'), { status }))
      await renderSettled()
      expect(screen.queryByTitle('OpenCode terminal'), String(status)).toBeNull()
      cleanup()
    }
  })

  it('(−) is hidden while the answer loads', async () => {
    h.get.mockImplementation((path: string) => (path === '/opencode/access' ? new Promise(() => undefined) : Promise.resolve({})))
    await renderSettled()
    expect(screen.queryByTitle('OpenCode terminal')).toBeNull()
  })

  it('reads only an exact `true` as yes', () => {
    expect(parseOpencodeAccess({ terminal: true, settings: true })).toEqual({ terminal: true, settings: true })
    expect(parseOpencodeAccess({ terminal: 'true', settings: 1 })).toEqual({ terminal: false, settings: false })
    expect(parseOpencodeAccess(null)).toEqual({ terminal: false, settings: false })
    expect(parseOpencodeAccess({})).toEqual({ terminal: false, settings: false })
  })
})

describe('terminal panel — a refused terminal says why, in the user\'s language', () => {
  it('(−) a 403 from POST /opencode/sessions shows the translated reason, and no socket is opened', async () => {
    h.post.mockRejectedValue(Object.assign(new Error('Forbidden: cannot manage OpenCode'), { status: 403 }))
    render(<WebTerminal conversationId="c1" />)
    await waitFor(() => expect(screen.getByText(en['opencode.terminal.forbidden'])).toBeInTheDocument())
    expect(h.post).toHaveBeenCalledTimes(1)
    expect(h.post).toHaveBeenCalledWith('/opencode/sessions', expect.objectContaining({ conversationId: 'c1', kind: 'tui' }))
  })

  it('(−) in Hungarian too; the socket\'s forbidden frame reads the same; other errors keep the server\'s text', () => {
    useLanguageStore.getState().setLang('hu')
    const forbidden = Object.assign(new Error('Forbidden: cannot manage OpenCode'), { status: 403 })
    expect(terminalOpenErrorText(forbidden)).toBe(hu['opencode.terminal.forbidden'])
    expect(terminalFrameErrorText({ type: 'error', code: 'forbidden', message: 'Forbidden: cannot manage OpenCode' } as never)).toBe(hu['opencode.terminal.forbidden'])
    expect(terminalOpenErrorText(Object.assign(new Error('OpenCode is disabled'), { status: 409 }))).toBe('OpenCode is disabled')
    expect(terminalFrameErrorText({ message: 'PTY session not found' })).toBe('PTY session not found')
    expect(terminalFrameErrorText({})).toBe(hu['opencode.terminal.socketError'])
  })

  it('has every terminal text, translated, in all six languages', () => {
    for (const [lang, bundle] of Object.entries(LOCALES)) {
      for (const key of TERMINAL_KEYS) {
        expect(bundle[key]?.trim(), `${lang}:${key}`).toBeTruthy()
        if (lang !== 'en') expect(bundle[key], `${lang}:${key}`).not.toBe(en[key])
      }
    }
  })
})
