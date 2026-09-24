// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G10 — a tool row looks the same on every provider: one icon and one label
// per outcome (a denied, waiting or skipped call is never green), the
// provider's own tool name as a tooltip, and a failure's text shown once.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

import { ToolCallDisplay } from '@/pages/conversations/components/tool-call-display'
import { TOOL_CALL_STATUSES, TOOL_STATUS_KEY, toolStatusOf } from '@/pages/conversations/tool-status'
import { t } from '@/pages/conversations/i18n'
import { useLanguageStore } from '@/stores/language-store'

describe('<ToolCallDisplay>', () => {
  beforeEach(() => useLanguageStore.getState().setLang('en'))
  afterEach(() => cleanup())

  it('(+) a denied call shows the denied icon and label, not a success', () => {
    render(<ToolCallDisplay call={{ toolUseId: 't1', toolName: 'run_command', status: 'denied', error: 'blocked by policy' }} />)
    expect(screen.getByRole('img', { name: 'Denied' }).getAttribute('data-status')).toBe('denied')
    expect(screen.getByTestId('tool-status-label').textContent).toBe('Denied')
    expect(screen.queryByRole('img', { name: 'Succeeded' })).toBeNull()
  })

  it('(+) needs approval, skipped and unknown are spelled out; success speaks through its icon', () => {
    for (const status of ['approval_required', 'skipped', 'unknown'] as const) {
      render(<ToolCallDisplay call={{ toolName: 'x', status }} />)
      expect(screen.getByTestId('tool-status-label').textContent).toBe(t(TOOL_STATUS_KEY[status]))
      cleanup()
    }
    render(<ToolCallDisplay call={{ toolName: 'read_file', status: 'success', output: 'ok' }} />)
    expect(screen.getByRole('img', { name: 'Succeeded' })).toBeTruthy()
    expect(screen.queryByTestId('tool-status-label')).toBeNull()
  })

  it('(+) the provider raw name is the tooltip of the canonical name', () => {
    render(<ToolCallDisplay call={{ toolName: 'edit_file', rawName: 'Edit', status: 'running' }} />)
    expect(screen.getByText('edit_file').getAttribute('title')).toBe("Provider's tool name: Edit")
  })

  it('(−) no tooltip when the raw name is the canonical one; a failure text is not shown twice', () => {
    render(<ToolCallDisplay call={{ toolName: 'grep', rawName: 'grep', status: 'error', output: 'EACCES', error: 'EACCES' }} />)
    expect(screen.getByText('grep').getAttribute('title')).toBeNull()
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(screen.getAllByText('EACCES')).toHaveLength(2) // the brief on the row + the error block, never an output block too
    expect(screen.queryByText('Output')).toBeNull()
  })

  // K1: a CLI search refused for what its folder contains carries a tagged
  // reason; the row explains it in the viewer's language.
  it('(+) a search refused as too broad is explained in the viewer\'s language, in every language and for every target', () => {
    const reason = 'Search too broad [memory-path:search-scope:foreign-memory]: the folder searched contains memory outside EYAS (Claude Code (~/.claude)), and this tool cannot leave it out — search a narrower folder that does not contain it'
    render(<ToolCallDisplay call={{ toolUseId: 't9', toolName: 'Grep', status: 'denied', error: reason }} />)
    expect(screen.getByTestId('tool-search-scope').textContent).toBe(t('conversations.toolCall.searchScope.foreignMemory'))
    cleanup()
    for (const lang of ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const) {
      useLanguageStore.getState().setLang(lang)
      for (const key of ['foreignMemory', 'eyasData', 'providerHome', 'otherWorkspace']) {
        const full = `conversations.toolCall.searchScope.${key}`
        expect(t(full), `${lang}/${key}`).not.toBe(full)
      }
    }
    useLanguageStore.getState().setLang('en')
    render(<ToolCallDisplay call={{ toolName: 'Bash', status: 'denied', output: 'Search too broad [memory-path:search-scope:eyas-data]: x' }} />)
    expect(screen.getByTestId('tool-search-scope').textContent).toBe(t('conversations.toolCall.searchScope.eyasData'))
  })

  it('(−) no explanation for another refusal, an unknown tag or a running row', () => {
    render(<ToolCallDisplay call={{ toolName: 'Read', status: 'denied', error: 'Memory outside EYAS (Claude Code) — use memory_search' }} />)
    expect(screen.queryByTestId('tool-search-scope')).toBeNull()
    cleanup()
    render(<ToolCallDisplay call={{ toolName: 'Grep', status: 'denied', error: '[memory-path:search-scope:elsewhere]' }} />)
    expect(screen.queryByTestId('tool-search-scope')).toBeNull()
    cleanup()
    render(<ToolCallDisplay call={{ toolName: 'Grep', status: 'running', output: '[memory-path:search-scope:eyas-data]' }} />)
    expect(screen.queryByTestId('tool-search-scope')).toBeNull()
  })

  it('(+) every row status has a label in every language', () => {
    for (const lang of ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const) {
      useLanguageStore.getState().setLang(lang)
      for (const status of TOOL_CALL_STATUSES) expect(t(TOOL_STATUS_KEY[status]), `${lang}/${status}`).not.toBe(TOOL_STATUS_KEY[status])
    }
  })
})

describe('toolStatusOf', () => {
  it('(+) a known outcome is the row status', () => {
    expect(toolStatusOf('denied')).toBe('denied')
    expect(toolStatusOf('skipped')).toBe('skipped')
  })

  it('(−) a missing or unknown outcome is never a success', () => {
    expect(toolStatusOf(undefined)).toBe('unknown')
    expect(toolStatusOf('great', 'boom')).toBe('error')
    expect(toolStatusOf('toString')).toBe('unknown')
  })
})
