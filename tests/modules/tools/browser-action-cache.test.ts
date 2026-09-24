// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createActionCacheStore,
  fallbackDurableLocator,
  isIndexSelector,
  normalizeIntent,
  publicCacheEntry,
  resolveActionCachePath,
} from '@modules/tools/builtin/browser-action-cache'
import { createBrowserTools } from '@modules/tools/builtin/browser-tools'
import { generateTotp } from '@modules/tools/builtin/totp'

describe('action cache path', () => {
  it('prefers vault procedural, then project folder, then dataDir', () => {
    expect(resolveActionCachePath({ dataDir: '/d', vaultBasePath: '/vault' })).toBe(
      join('/vault', 'procedural', 'browser-action-cache.json'),
    )
    expect(resolveActionCachePath({ dataDir: '/d', vaultBasePath: '/vault', projectId: 'p1' })).toBe(
      join('/vault', 'projects', 'p1', 'browser-action-cache.json'),
    )
    expect(resolveActionCachePath({ dataDir: '/d' })).toBe(join('/d', 'browser', 'action-cache.json'))
    expect(resolveActionCachePath({ dataDir: '/d', projectId: 'p1' })).toBe(
      join('/d', 'browser', 'action-cache', 'p1.json'),
    )
  })
})

describe('createActionCacheStore', () => {
  it('remembers a locator and replays by origin+intent without storing fill values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eyas-actcache-'))
    const path = join(dir, 'browser-action-cache.json')
    const store = createActionCacheStore({ path })
    const entry = await store.remember({
      origin: 'https://login.example.com/x',
      intent: '  Click Submit  ',
      action: 'click',
      locator: { kind: 'css', value: 'button[type="submit"]' },
    })
    expect(entry.intent).toBe('click submit')
    expect(entry.origin).toBe('https://login.example.com')
    const hit = await store.lookup('https://login.example.com', 'click submit')
    expect(hit?.locator).toEqual({ kind: 'css', value: 'button[type="submit"]' })
    const raw = await readFile(path, 'utf8')
    expect(raw).not.toMatch(/password|secret|totp/i)
    const parsed = JSON.parse(raw)
    expect(parsed.entries[0].locator.value).toBe('button[type="submit"]')
    expect(parsed.entries[0]).not.toHaveProperty('fillValue')
    expect(Object.keys(parsed.entries[0])).not.toContain('value')
    const listed = await store.list('https://login.example.com')
    expect(listed).toHaveLength(1)
    expect(publicCacheEntry(listed[0]!)).not.toHaveProperty('secret')
  })

  it('forgets by intent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eyas-actcache-'))
    const store = createActionCacheStore({ path: join(dir, 'c.json') })
    await store.remember({
      origin: 'https://a.example',
      intent: 'click submit',
      action: 'click',
      locator: { kind: 'css', value: '#go' },
    })
    expect((await store.forget({ intent: 'click submit' })).removed).toBe(1)
    expect(await store.lookup('https://a.example', 'click submit')).toBeNull()
  })
})

describe('locator helpers', () => {
  it('refuses to treat snapshot indexes as durable', () => {
    expect(isIndexSelector('[data-eyas-index="3"]')).toBe(true)
    expect(fallbackDurableLocator('[data-eyas-index="3"]')).toBeNull()
    expect(fallbackDurableLocator('#submit')).toEqual({ kind: 'css', value: '#submit' })
    expect(normalizeIntent('  Click   Submit ')).toBe('click submit')
  })
})

function createFakeBundle() {
  const pages: any[] = []
  function makePage(startUrl = 'https://login.example.com/form') {
    let url = startUrl
    let closed = false
    const navHandlers: Array<(frame: any) => unknown> = []
    const frame = { parentFrame: () => null, url: () => url }
    const page: any = {
      url: () => url,
      title: async () => 'Login',
      goto: vi.fn(async (next: string) => {
        url = next
        for (const h of navHandlers) await h(frame)
      }),
      click: vi.fn(async () => {}),
      fill: vi.fn(async () => {}),
      hover: vi.fn(async () => {}),
      selectOption: vi.fn(async () => ['chosen']),
      screenshot: async () => Buffer.from('png'),
      evaluate: vi.fn(async (fn: unknown, arg?: unknown) => {
        if (typeof fn === 'string' && fn.includes('durableLocator')) {
          return { kind: 'css', value: 'button[type="submit"]' }
        }
        if (typeof fn === 'string' && fn.includes('data-eyas-index')) {
          return [{ index: 1, tag: 'button', role: 'button', name: 'Submit' }]
        }
        if (typeof fn === 'function' && arg !== undefined) return (0, eval)(String(arg))
        return [{ index: 1, tag: 'button', role: 'button', name: 'Submit' }]
      }),
      locator: () => ({ ariaSnapshot: async () => '- document: Login' }),
      getByRole: vi.fn(() => ({
        click: vi.fn(async () => {}),
        fill: vi.fn(async () => {}),
        hover: vi.fn(async () => {}),
        selectOption: vi.fn(async () => ['chosen']),
      })),
      waitForSelector: vi.fn(async () => {}),
      waitForURL: vi.fn(async () => {}),
      waitForLoadState: vi.fn(async () => {}),
      waitForTimeout: vi.fn(async () => {}),
      bringToFront: vi.fn(async () => {}),
      close: async () => {
        closed = true
      },
      isClosed: () => closed,
      mainFrame: () => frame,
      on: (ev: string, h: (arg: any) => unknown) => {
        if (ev === 'framenavigated') navHandlers.push(h)
      },
    }
    pages.push(page)
    return page
  }
  const first = makePage()
  const context: any = {
    newPage: vi.fn(async () => makePage()),
    pages: () => pages.filter((p) => !p.isClosed()),
    close: vi.fn(async () => {}),
    storageState: vi.fn(async () => ({ cookies: [], origins: [] })),
    addCookies: vi.fn(async () => {}),
    browser: () => browser,
  }
  const browser = { newContext: async () => context, close: vi.fn(async () => {}) }
  return { browser, context, page: first, pages }
}

async function toolsWithFake(extra: Record<string, unknown> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'eyas-browser-cache-'))
  const vault = await mkdtemp(join(tmpdir(), 'eyas-vault-cache-'))
  const fake = createFakeBundle()
  const tools = createBrowserTools({
    dataDir,
    persistProfile: false,
    launch: async () => fake,
    getVaultBasePath: () => vault,
    getSecrets: () => extra.secrets as any,
    readOsKeychain: extra.readOsKeychain as any,
  })
  return { tools, fake, dataDir, vault }
}

describe('createBrowserTools cache + totp', () => {
  it('registers replay, action cache, and yellow totp', () => {
    const list = createBrowserTools()
    const names = list.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['browser_replay', 'browser_action_cache', 'browser_totp']))
    expect(list.find((t) => t.name === 'browser_totp')?.riskTier).toBe('yellow')
    expect(list.find((t) => t.name === 'browser_replay')?.riskTier).toBe('red')
    expect(list.find((t) => t.name === 'browser_action_cache')?.riskTier).toBe('yellow')
  })

  it('remembers a successful click by intent and replays without a snapshot index', async () => {
    const { tools, fake } = await toolsWithFake()
    const navigate = tools.find((t) => t.name === 'browser_navigate')!
    const snapshot = tools.find((t) => t.name === 'browser_snapshot')!
    const click = tools.find((t) => t.name === 'browser_click')!
    const replay = tools.find((t) => t.name === 'browser_replay')!
    await navigate.execute({ url: 'https://login.example.com/form' })
    await snapshot.execute({})
    const first = await click.execute({ index: 1, intent: 'click Submit' })
    expect(first).toMatchObject({ success: true, remembered: true })
    expect((first as any).cache.locator).toEqual({ kind: 'css', value: 'button[type="submit"]' })
    fake.page.click.mockClear()
    const second = await replay.execute({ intent: 'click Submit' })
    expect(second).toMatchObject({ success: true, replayed: true })
    expect(fake.page.click).toHaveBeenCalledWith('button[type="submit"]', expect.any(Object))
  })

  it('fills a TOTP code from Secrets and never returns the seed', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    const { tools } = await toolsWithFake({
      secrets: { get: async (name: string, scope: string) => (name === 'github-totp' && scope === 'system' ? secret : null) },
    })
    const totp = tools.find((t) => t.name === 'browser_totp')!
    const out = await totp.execute({ name: 'github-totp' })
    expect(out).toMatchObject({ digits: 6 })
    expect(String((out as any).code)).toMatch(/^\d{6}$/)
    expect(JSON.stringify(out)).not.toMatch(/GEZDGNBVGY3TQOJQ|12345678901234567890/i)
    const expected = generateTotp(secret)
    expect((out as any).code).toBe(expected.code)
  })

  it('falls back to Keychain when Secrets miss', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    const { tools } = await toolsWithFake({
      secrets: { get: async () => null },
      readOsKeychain: async (service: string) => (service === 'eyas-totp-github' ? secret : null),
    })
    const totp = tools.find((t) => t.name === 'browser_totp')!
    const out = await totp.execute({ name: 'github' })
    expect((out as any).code).toBe(generateTotp(secret).code)
  })
})
