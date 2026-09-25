// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@/api/workspace', () => ({
  loadWorkspaceFile: vi.fn(async () => ({ exists: true, body: '' })),
  saveWorkspaceFile: vi.fn(async () => undefined),
}))
vi.mock('@/pages/agents/components/IdentityEditor', () => ({ IdentityEditor: () => <div /> }))
vi.mock('@/pages/agents/components/WorkspaceFileEditor', () => ({ WorkspaceFileEditor: () => <div /> }))
vi.mock('@/pages/agents/components/WorkspaceHistoryPanel', () => ({ WorkspaceHistoryPanel: () => null }))

import { AgentWorkspaceTab } from '@/pages/agents/components/AgentWorkspaceTab'

const KEY = 'agents.workspaceTab.file.memoryHint'
const DIR = join(process.cwd(), 'src/web/src/pages/agents/locales')
const LANGS = ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const
const bundle = (lang: string) => JSON.parse(readFileSync(join(DIR, `${lang}.json`), 'utf8')) as Record<string, string>
const EN_HINT = bundle('en')[KEY]

describe('AgentWorkspaceTab — MEMORY.md hint', () => {
  it('explains that MEMORY.md is owner notes the model never sees', async () => {
    render(<AgentWorkspaceTab agentId="a1" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'MEMORY.md' } })
    await waitFor(() => expect(screen.getByText(EN_HINT)).toBeInTheDocument())
  })

  it('shows no memory hint for the other workspace files', async () => {
    render(<AgentWorkspaceTab agentId="a1" />)
    for (const file of ['IDENTITY.md', 'AGENTS.md', 'TOOLS.md']) {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: file } })
      await waitFor(() => expect(screen.queryByText(EN_HINT)).not.toBeInTheDocument())
    }
  })

  it('has a real translation of the hint in all six languages', () => {
    expect(EN_HINT).toMatch(/not send this file to the model/)
    for (const lang of LANGS) {
      const value = bundle(lang)[KEY]
      expect(value, lang).toBeTruthy()
      if (lang !== 'en') expect(value, lang).not.toBe(EN_HINT)
    }
  })
})
