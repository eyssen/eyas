// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The preview sheet. The owner reads a file here before deciding it, so these
// cases assert the things a summary cannot: that the head is shown and named as
// a head of something imported whole, that a binary row says so instead of
// printing bytes, and — A-28 — that a persona or rule file says out loud that
// its content becomes prompt text, where no recall gate can protect it.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// The Radix dialog behind `Sheet` pulls in `react-remove-scroll` and friends,
// which live only under `src/web/node_modules` and ship a CJS build that
// `require`s the nested React copy outside Vite's alias — every render then
// dies on "resolveDispatcher().useRef". It is the same duplicate-React problem
// `ContextualHelp` is mocked for in `scheduler-page.test.tsx`, and it is
// unrelated to anything under test here: the panel's own markup is the subject,
// not the primitive that positions it.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}))

import { PreviewSheet, PROMPT_VERBATIM_EN, type PreviewPayload } from '@/pages/settings/data-port-preview'
import { formatBytes } from '@/pages/settings/data-port-progress'
import { t } from '@/pages/settings/i18n'
import type { PublicCandidate } from '@/pages/settings/data-port-types'

function candidate(overrides: Partial<PublicCandidate> & { id: string }): PublicCandidate {
  return {
    relativePath: `notes/${overrides.id}.md`,
    seq: 1,
    folder: 'notes',
    importable: true,
    kind: 'memory',
    target: 'vault.semantic',
    title: overrides.id,
    preview: '',
    bytes: 100_000,
    confidence: 0.9,
    reason: 'Memory note',
    reasonCode: 'memory-note',
    selectedByDefault: true,
    ...overrides,
  }
}

function renderSheet(
  c: PublicCandidate,
  preview: PreviewPayload | null,
  overrides: Partial<React.ComponentProps<typeof PreviewSheet>> = {},
) {
  const onToggle = vi.fn()
  const onSetTarget = vi.fn()
  const onOpenChange = vi.fn()
  const utils = render(
    <PreviewSheet
      open
      candidate={c}
      preview={preview}
      selected
      target={c.target}
      lang="en"
      onToggle={onToggle}
      onSetTarget={onSetTarget}
      onOpenChange={onOpenChange}
      {...overrides}
    />,
  )
  return { ...utils, onToggle, onSetTarget, onOpenChange }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PreviewSheet', () => {
  it('shows the head and says it is only the head of a file imported in full', () => {
    renderSheet(candidate({ id: 'alpha' }), {
      candidate: candidate({ id: 'alpha' }),
      head: 'alpha body',
      truncated: true,
      encoding: 'utf-8',
      bytes: 65_536,
      size: 100_000,
    })
    expect(screen.getByText('alpha body')).toBeTruthy()
    expect(
      screen.getByText(
        t('settings.dataPort.wizard.preview.truncated', {
          shown: formatBytes(65_536, 'en'),
          total: formatBytes(100_000, 'en'),
        }),
      ),
    ).toBeTruthy()
    expect(screen.getByText(/imported in full/)).toBeTruthy()
  })

  it('names binary content instead of printing it', () => {
    const c = candidate({ id: 'logo', kind: 'noise', importable: false, target: 'none', reasonCode: 'binary' })
    renderSheet(c, { candidate: c, encoding: 'binary', head: null, truncated: false })
    expect(screen.getByText(t('settings.dataPort.wizard.preview.binary'))).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toHaveProperty('disabled', true)
  })

  it('lists the first entries of a folder the walker did not enter', () => {
    const c = candidate({
      id: 'deps',
      title: 'node_modules',
      importable: false,
      target: 'none',
      kind: 'noise',
      reasonCode: 'directory-skipped:node_modules',
      directory: { class: 'node_modules', files: 1420, dirs: 9, unreadable: 0 },
    })
    renderSheet(c, { candidate: c, encoding: 'directory', head: null, truncated: false, children: ['react', 'zod'] })
    expect(screen.getByText(t('settings.dataPort.wizard.preview.children'))).toBeTruthy()
    expect(screen.getByText('react')).toBeTruthy()
    expect(screen.getByText('zod')).toBeTruthy()
  })

  it('lists the files bundled with a skill and every path the same content was found at', () => {
    const c = candidate({
      id: 'skill',
      kind: 'skill',
      target: 'skill',
      assets: [{ relPath: 'run.sh', bytes: 2048, sha256: 'x', binary: false }],
      paths: ['skills/skill/SKILL.md', 'backup/SKILL.md'],
    })
    renderSheet(c, { candidate: c, head: '# skill', encoding: 'utf-8', truncated: false })
    expect(screen.getByText(t('settings.dataPort.wizard.preview.assets'))).toBeTruthy()
    expect(screen.getByText(`run.sh — ${formatBytes(2048, 'en')}`)).toBeTruthy()
    expect(screen.getByText(t('settings.dataPort.wizard.preview.paths'))).toBeTruthy()
    expect(screen.getByText('backup/SKILL.md')).toBeTruthy()
  })

  it('marks a row that carries a credential and explains what happens to it', () => {
    const c = candidate({ id: 'keys', tags: ['contains-secrets'] })
    renderSheet(c, { candidate: c, head: 'token=…', encoding: 'utf-8', truncated: false })
    expect(screen.getByTitle(t('settings.dataPort.wizard.containsSecretsHint'))).toBeTruthy()
  })

  it('says plainly that a persona or rule file is used verbatim in prompts (A-28)', () => {
    const persona = candidate({ id: 'coach', kind: 'persona', target: 'agent', tags: ['contains-secrets'] })
    const { unmount } = renderSheet(persona, { candidate: persona, head: 'You are…', encoding: 'utf-8', truncated: false })
    expect(screen.getByText(PROMPT_VERBATIM_EN)).toBeTruthy()
    unmount()

    const note = candidate({ id: 'alpha', tags: ['contains-secrets'] })
    renderSheet(note, { candidate: note, head: 'body', encoding: 'utf-8', truncated: false })
    // An ordinary note IS gated at recall, so it must not carry the same claim.
    expect(screen.queryByText(PROMPT_VERBATIM_EN)).toBeNull()
  })

  it('mirrors the row’s own checkbox and destination, and reports both', () => {
    const rule = candidate({ id: 'rules', kind: 'rule', target: 'workspace.tools' })
    const { onToggle, onSetTarget } = renderSheet(rule, {
      candidate: rule,
      head: 'rules',
      encoding: 'utf-8',
      truncated: false,
    })
    const box = screen.getByLabelText(`${t('settings.dataPort.wizard.preview.title')}: rules`)
    expect(box).toHaveProperty('checked', true)
    fireEvent.click(box)
    expect(onToggle).toHaveBeenCalledWith(false)

    const select = screen.getByLabelText(`${t('settings.dataPort.wizard.targetLabel')}: rules`)
    fireEvent.change(select, { target: { value: 'workspace.agents' } })
    expect(onSetTarget).toHaveBeenCalledWith('workspace.agents')
  })

  it('shows a read failure rather than an empty panel', () => {
    const c = candidate({ id: 'gone' })
    renderSheet(c, null, { error: 'ENOENT: no such file' })
    expect(screen.getByText('ENOENT: no such file')).toBeTruthy()
  })

  it('renders nothing at all without a candidate', () => {
    const { container } = render(
      <PreviewSheet
        open
        candidate={null}
        preview={null}
        selected={false}
        target="none"
        lang="en"
        onToggle={vi.fn()}
        onSetTarget={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    )
    expect(container.innerHTML).toBe('')
  })
})
