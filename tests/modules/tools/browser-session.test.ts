// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createBrowserSessionManager,
  serializeEvaluateResult,
  STALE_SNAPSHOT_MESSAGE,
} from '@modules/tools/builtin/browser-session'
import { createBrowserTools } from '@modules/tools/builtin/browser-tools'

function createFakeBundle() {
  const pages: any[] = []

  function makePage(startUrl = 'about:blank') {
    let url = startUrl
    let closed = false
    const navHandlers: Array<(frame: any) => unknown> = []
    const dialogHandlers: Array<(dialog: any) => unknown> = []
    const frame = { parentFrame: () => null, url: () => url }
    const page: any = {
      url: () => url,
      title: async () => (url === 'about:blank' ? '' : 'Example'),
      goto: vi.fn(async (next: string) => {
        url = next
        for (const h of navHandlers) await h(frame)
      }),
      goBack: vi.fn(async () => {
        url = 'https://example.com/back'
        for (const h of navHandlers) await h(frame)
      }),
      click: vi.fn(async () => {}),
      fill: vi.fn(async () => {}),
      hover: vi.fn(async () => {}),
      selectOption: vi.fn(async () => ['chosen']),
      setInputFiles: vi.fn(async () => {}),
      screenshot: async () => Buffer.from('png'),
      evaluate: vi.fn(async (fn: unknown, arg?: unknown) => {
        if (typeof fn === 'string' && fn.includes('durableLocator')) {
          return { kind: 'css', value: '#docs' }
        }
        if (typeof fn === 'function' && arg !== undefined) return (0, eval)(String(arg))
        if (typeof fn === 'string' && fn.includes('data-eyas-index')) {
          return [{ index: 1, tag: 'a', role: 'link', name: 'Docs' }]
        }
        if (typeof fn === 'function') return 'page text'
        return [{ index: 1, tag: 'a', role: 'link', name: 'Docs' }]
      }),
      locator: () => ({ ariaSnapshot: async () => '- document: Example' }),
      waitForSelector: vi.fn(async () => {}),
      waitForURL: vi.fn(async () => {}),
      waitForLoadState: vi.fn(async () => {}),
      waitForTimeout: vi.fn(async () => {}),
      waitForEvent: vi.fn(async (ev: string) => {
        if (ev !== 'download') throw new Error(`unexpected event ${ev}`)
        return {
          suggestedFilename: () => 'report.csv',
          saveAs: async (p: string) => {
            await writeFile(p, 'a,b\n1,2\n')
          },
        }
      }),
      bringToFront: vi.fn(async () => {}),
      close: async () => {
        closed = true
      },
      isClosed: () => closed,
      mainFrame: () => frame,
      on: (ev: string, h: (arg: any) => unknown) => {
        if (ev === 'framenavigated') navHandlers.push(h)
        if (ev === 'dialog') dialogHandlers.push(h)
      },
      _dialogHandlers: dialogHandlers,
    }
    pages.push(page)
    return page
  }

  const first = makePage()
  const context: any = {
    newPage: vi.fn(async () => makePage()),
    pages: () => pages.filter((p) => !p.isClosed()),
    close: vi.fn(async () => {}),
    storageState: vi.fn(async (opts?: { path?: string }) => {
      const state = { cookies: [{ name: 'sid', value: '1', domain: 'example.com', path: '/' }], origins: [] }
      if (opts?.path) await writeFile(opts.path, JSON.stringify(state))
      return state
    }),
    addCookies: vi.fn(async () => {}),
    browser: () => browser,
  }
  const browser = {
    newContext: async () => context,
    close: vi.fn(async () => {}),
  }
  return { browser, context, page: first, pages }
}

async function managerWithFake(extra: Record<string, unknown> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'eyas-browser-'))
  const fake = createFakeBundle()
  const mgr = createBrowserSessionManager({
    persistProfile: false,
    dataDir,
    launch: async () => fake,
    ...extra,
  })
  return { mgr, fake, dataDir }
}

describe('serializeEvaluateResult', () => {
  it('returns structured JSON under the cap', () => {
    expect(serializeEvaluateResult({ a: 1 })).toEqual({ result: { a: 1 }, truncated: false })
  })

  it('truncates oversized results', () => {
    const big = 'x'.repeat(60_000)
    const out = serializeEvaluateResult(big)
    expect(out.truncated).toBe(true)
    expect(String(out.result).length).toBe(50_000)
  })
})

describe('browser session expansion', () => {
  it('accepts an index after snapshot and rejects it after navigate', async () => {
    const { mgr, fake } = await managerWithFake()
    await mgr.navigate('https://example.com/')
    const snap = await mgr.snapshot()
    expect(snap.snapshotId).toMatch(/^t1s\d+$/)
    expect(snap.tabId).toBe(1)
    expect(snap.elements[0]?.name).toBe('Docs')
    await expect(mgr.click({ index: 1 })).resolves.toMatchObject({ success: true, selector: '[data-eyas-index="1"]' })
    await mgr.navigate('https://example.com/next')
    await expect(mgr.click({ index: 1 })).rejects.toThrow(STALE_SNAPSHOT_MESSAGE)
    expect(fake.page.click).toHaveBeenCalled()
  })

  it('rejects a snapshotId from a previous generation', async () => {
    const { mgr } = await managerWithFake()
    await mgr.navigate('https://example.com/')
    const snap = await mgr.snapshot()
    await mgr.navigate('https://example.com/other')
    await expect(mgr.click({ index: 1, snapshotId: snap.snapshotId })).rejects.toThrow(STALE_SNAPSHOT_MESSAGE)
  })

  it('opens, lists, switches, and refuses to close the last tab', async () => {
    const { mgr, fake } = await managerWithFake()
    await mgr.navigate('https://example.com/')
    const opened = await mgr.openTab('https://example.com/two')
    expect(opened.tabId).toBe(2)
    const listed = await mgr.tabs()
    expect(listed.tabs).toHaveLength(2)
    expect(listed.activeTabId).toBe(2)
    await mgr.switchTab(1)
    expect((await mgr.tabs()).activeTabId).toBe(1)
    await mgr.closeTab(2)
    expect((await mgr.tabs()).tabs).toHaveLength(1)
    await expect(mgr.closeTab(1)).rejects.toThrow(/last tab/)
    expect(fake.context.newPage).toHaveBeenCalled()
  })

  it('goes back, waits, hovers, selects, and arms a dialog', async () => {
    const { mgr, fake } = await managerWithFake()
    await mgr.navigate('https://example.com/')
    await mgr.snapshot()
    await expect(mgr.back()).resolves.toMatchObject({ url: 'https://example.com/back' })
    await mgr.snapshot()
    await mgr.wait({ kind: 'selector', index: 1 })
    await mgr.hover({ index: 1 })
    await mgr.select({ index: 1 }, 'de')
    expect(mgr.armDialog('accept', 'yes')).toEqual({ armed: 'accept' })
    expect(fake.page.goBack).toHaveBeenCalled()
    expect(fake.page.hover).toHaveBeenCalled()
    expect(fake.page.selectOption).toHaveBeenCalled()
  })

  it('uploads workspace files via setInputFiles', async () => {
    const { mgr, fake } = await managerWithFake()
    await mgr.navigate('https://example.com/')
    await mgr.snapshot()
    await mgr.upload({ index: 1 }, ['/tmp/file.txt'])
    expect(fake.page.setInputFiles).toHaveBeenCalledWith('[data-eyas-index="1"]', ['/tmp/file.txt'], expect.any(Object))
  })

  it('evaluates an expression in the page', async () => {
    const { mgr } = await managerWithFake()
    await mgr.navigate('https://example.com/')
    await expect(mgr.evaluate('1 + 2')).resolves.toEqual({ result: 3, truncated: false })
  })

  it('ingests a download into Documents and links the conversation', async () => {
    const upload = vi.fn(async ({ filename }: { filename: string }) => ({
      id: 'doc-1',
      filename,
      sizeBytes: 8,
    }))
    const link = vi.fn()
    const { mgr } = await managerWithFake({
      getDocuments: () => ({ upload, link }),
    })
    await mgr.navigate('https://example.com/')
    await mgr.snapshot()
    const result = await mgr.download({ index: 1 }, { conversationId: 'conv-1', userId: 'u1' })
    expect(result).toMatchObject({ ingested: true, documentId: 'doc-1', filename: 'report.csv' })
    expect(upload).toHaveBeenCalled()
    expect(link).toHaveBeenCalledWith('doc-1', 'conversations', 'conv-1', 'ai')
  })

  it('saves Playwright storageState to the instance data dir', async () => {
    const { mgr, dataDir } = await managerWithFake()
    await mgr.navigate('https://example.com/')
    const saved = await mgr.saveStorageState()
    expect(saved.path).toContain(join(dataDir, 'browser'))
    const raw = await readFile(saved.path, 'utf8')
    expect(JSON.parse(raw).cookies[0].name).toBe('sid')
  })

  it('invokes stamp/locator scripts as IIFEs (Playwright string evaluate ignores args)', async () => {
    const { mgr, fake } = await managerWithFake()
    await mgr.navigate('https://example.com/')
    await mgr.snapshot()
    const stamp = fake.page.evaluate.mock.calls.find((c: unknown[]) => String(c[0]).includes('data-eyas-index'))
    expect(String(stamp?.[0])).toMatch(/\)\(\)\s*$/)
    expect(stamp?.[1]).toBeUndefined()
    await mgr.durableLocator({ index: 1 })
    const loc = fake.page.evaluate.mock.calls.find((c: unknown[]) => String(c[0]).includes('durableLocator'))
    expect(String(loc?.[0])).toContain('[data-eyas-index=')
    expect(loc?.[1]).toBeUndefined()
  })

  it('extracts a durable locator and acts by it without an index', async () => {
    const { mgr, fake } = await managerWithFake()
    await mgr.navigate('https://example.com/')
    await mgr.snapshot()
    const locator = await mgr.durableLocator({ index: 1 })
    expect(locator).toEqual({ kind: 'css', value: '#docs' })
    await mgr.actByLocator('click', locator)
    expect(fake.page.click).toHaveBeenCalledWith('#docs', expect.any(Object))
  })

  it('blocks private hosts on tab open and wait-for-url', async () => {
    const { mgr } = await managerWithFake()
    await mgr.navigate('https://example.com/')
    await expect(mgr.openTab('http://127.0.0.1/admin')).rejects.toThrow(/SSRF/i)
    await expect(mgr.wait({ kind: 'url', url: 'http://10.0.0.1/' })).rejects.toThrow(/SSRF/i)
  })
})

describe('createBrowserTools', () => {
  it('registers the expanded headless surface', () => {
    const names = createBrowserTools().map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining([
      'browser_navigate',
      'browser_tabs',
      'browser_back',
      'browser_wait',
      'browser_hover',
      'browser_select',
      'browser_dialog',
      'browser_upload',
      'browser_evaluate',
      'browser_download',
      'browser_storage',
      'browser_replay',
      'browser_action_cache',
      'browser_totp',
      'browser_close',
    ]))
    const evaluate = createBrowserTools().find((t) => t.name === 'browser_evaluate')
    expect(evaluate?.riskTier).toBe('red')
    expect(evaluate?.requiresApproval).toBe(true)
    expect(createBrowserTools().find((t) => t.name === 'browser_totp')?.riskTier).toBe('yellow')
    expect(createBrowserTools().find((t) => t.name === 'browser_replay')?.riskTier).toBe('red')
  })
})
