// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B12 — every folder editor (projects, project types, a conversation's
// Folders) maps the server's refusal code to projects.folders.error.<code>,
// with the refused folder's path from the error body. The six projects
// locales hold the full key family (never empty, {{path}} in each).

import { describe, it, expect, afterEach, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import { useLanguageStore } from '@/stores/language-store'
import { FOLDER_ERROR_CODES, folderErrorText } from '@/pages/projects/i18n'
import { FOLDER_ERROR_CODES as SERVER_CODES } from '@modules/tools/working-directories'
import en from '@/pages/projects/locales/en.json'
import hu from '@/pages/projects/locales/hu.json'
import de from '@/pages/projects/locales/de.json'
import es from '@/pages/projects/locales/es.json'
import fr from '@/pages/projects/locales/fr.json'
import tlh from '@/pages/projects/locales/tlh.json'

const LOCALES: Record<string, Record<string, string>> = { en, hu, de, es, fr, tlh }

afterEach(() => {
  useLanguageStore.getState().setLang('en')
  vi.unstubAllGlobals()
})

describe('projects.folders.error.*', () => {
  it('the web knows exactly the codes the server sends', () => {
    expect([...FOLDER_ERROR_CODES]).toEqual([...SERVER_CODES])
  })

  it('has a non-empty text with {{path}} for every code in all six languages', () => {
    for (const [lang, bundle] of Object.entries(LOCALES)) {
      for (const code of FOLDER_ERROR_CODES) {
        const text = bundle[`projects.folders.error.${code}`]
        expect(typeof text === 'string' && text.trim().length > 0, `${lang}:${code}`).toBe(true)
        expect(text, `${lang}:${code}`).toContain('{{path}}')
      }
      expect(bundle['projects.types.saveFailed']?.trim(), lang).toBeTruthy()
    }
  })

  // K2: a folder refused for what it contains names the protected place found.
  it('the contains* codes carry {{found}} in all six languages; the other codes do not need it', () => {
    const contains = FOLDER_ERROR_CODES.filter((c) => c.startsWith('contains'))
    expect(contains).toEqual(['containsEyasData', 'containsProviderHome', 'containsVault'])
    for (const [lang, bundle] of Object.entries(LOCALES)) {
      for (const code of contains) expect(bundle[`projects.folders.error.${code}`], `${lang}:${code}`).toContain('{{found}}')
      expect(bundle['projects.folders.error.vault'], lang).not.toContain('{{found}}')
    }
  })
})

describe('folderErrorText', () => {
  it('maps a refusal code to the translated text with the path (positive)', () => {
    const err = new ApiError(400, 'folder refused: /x is inside a notes vault', 'vault', { code: 'vault', path: '/notes/daily' })
    expect(folderErrorText(err, 'fallback')).toBe(en['projects.folders.error.vault'].replace('{{path}}', '/notes/daily'))
    useLanguageStore.getState().setLang('hu')
    expect(folderErrorText(err, 'fallback')).toBe(hu['projects.folders.error.vault'].replace('{{path}}', '/notes/daily'))
  })

  it('a contains* refusal shows the folder and the protected place found in it (positive)', () => {
    const err = new ApiError(400, 'folder refused', 'containsVault', { code: 'containsVault', path: '/work/docs', found: '/work/docs/Notes' })
    const text = folderErrorText(err, 'fallback')
    expect(text).toBe(en['projects.folders.error.containsVault'].replace('{{path}}', '/work/docs').replace('{{found}}', '/work/docs/Notes'))
    useLanguageStore.getState().setLang('de')
    expect(folderErrorText(err, 'fallback')).toContain('/work/docs/Notes')
  })

  it("falls back to the server's message for any other error, then to the fallback (negative)", () => {
    expect(folderErrorText(new ApiError(400, 'workingDirectories must be a list of absolute folder paths'), 'fb'))
      .toBe('workingDirectories must be a list of absolute folder paths')
    expect(folderErrorText(new ApiError(409, 'busy', 'GodModeBusyError'), 'fb')).toBe('busy')
    expect(folderErrorText(new Error(''), 'fb')).toBe('fb')
    expect(folderErrorText('boom', 'fb')).toBe('fb')
  })
})

describe('ApiError.details', () => {
  it('carries the error body, so the refused path reaches the message (positive)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'folder refused: /home/x is the filesystem root, the home folder or a folder above it', code: 'home', path: '/home/x' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )))
    let caught: unknown
    try {
      await api.patch('/projects/p1', { workingDirectories: ['/home/x'] })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).details).toMatchObject({ code: 'home', path: '/home/x' })
    expect(folderErrorText(caught, 'fb')).toBe(en['projects.folders.error.home'].replace('{{path}}', '/home/x'))
  })

  it('a refusal without a path still reads (negative: no {{path}} left over)', () => {
    const text = folderErrorText(new ApiError(400, 'x', 'notFound'), 'fb')
    expect(text).not.toContain('{{path}}')
  })
})
