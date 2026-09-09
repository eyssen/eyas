// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Browser session manager using Playwright.
 * Manages browser lifecycle, tabs, URL allowlists, snapshot generations,
 * and an EYAS-owned persistent profile (never the daily Chrome profile).
 *
 * The browser itself comes from shared/playwright-loader, which is the one
 * place that knows how to find a Chromium — the same resolution the design
 * module's print pipeline uses.
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { assertEyAsUserDataDir, launchChromium, launchPersistentChromium } from '@shared/playwright-loader.js'
import { resolveInstance } from '@core/instance.js'
// Re-exported for the tools that have always imported them from here. The
// predicates themselves moved to shared/net-guard so the headless browser can
// apply the same rule to every sub-resource, not just the URL it was handed.
export { assertSafeBrowserUrl, isPrivateOrLocalHost } from '@shared/net-guard.js'
import { assertSafeBrowserUrl } from '@shared/net-guard.js'
import {
  formatInteractiveSnapshot,
  indexSelector,
  STAMP_INTERACTIVE_JS,
  EXTRACT_LOCATOR_JS,
  type InteractiveElement,
} from './browser-dom.js'
import type { CacheableAction, DurableLocator } from './browser-action-cache.js'
import { fallbackDurableLocator } from './browser-action-cache.js'

export const STALE_SNAPSHOT_MESSAGE =
  'Interactive snapshot is stale (page navigated or tab changed). Call browser_snapshot again.'

export const USER_AGENT = 'EYAS/1.0 Browser Agent'
const VIEWPORT = { width: 1280, height: 720 }
const EVALUATE_MAX_CHARS = 50_000
const WAIT_MAX_MS = 30_000
const WAIT_TIMEOUT_KIND_MAX_MS = 10_000
const DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024

export interface BrowserDocuments {
  upload: (input: {
    file: Buffer
    filename: string
    createdBy?: string
    metadata?: Record<string, unknown>
    module?: string
  }) => Promise<{ id: string; filename: string; sizeBytes: number }>
  link: (documentId: string, ownerModule: string, ownerId: string, source?: string) => unknown
}

export interface BrowserSessionConfig {
  urlAllowlist?: RegExp[] // Allowed URL patterns (empty = allow all)
  maxSessionDurationMs?: number // Default: 5 minutes
  headless?: boolean // Default: true
  screenshotDir?: string // Where to save screenshots
  allowPrivateHosts?: boolean
  /** EYAS-owned Chromium profile. Never a daily Chrome/Edge directory. */
  userDataDir?: string
  storageStatePath?: string
  /** Default true. Tests inject `launch` and set this false. */
  persistProfile?: boolean
  dataDir?: string
  getDocuments?: () => BrowserDocuments | null | undefined
  /** Test seam: skip Playwright launch. */
  launch?: () => Promise<{ browser: any; context: any; page: any }>
}

export interface BrowserTarget {
  selector?: string
  index?: number
  snapshotId?: string
}

export interface BrowserTabInfo {
  id: number
  url: string
  title: string
  active: boolean
  snapshotId: string | null
}

export interface BrowserSession {
  page: any // playwright.Page (active tab)
  browser: any // playwright.Browser
  context: any // playwright.BrowserContext
  startedAt: number
  lastActionAt: number
}

interface TabState {
  id: number
  page: any
  snapshotSeq: number
  lastSnapshotSeq: number | null
}

interface LiveSession extends BrowserSession {
  tabs: Map<number, TabState>
  activeTabId: number
  nextTabId: number
  persistent: boolean
}

const DEFAULT_URL_ALLOWLIST: RegExp[] = [
  /^https?:\/\/.*/, // Allow all HTTP(S) by default — restrict via config
]

export function defaultBrowserUserDataDir(dataDir: string): string {
  return join(dataDir, 'browser', 'profile')
}

export function defaultBrowserStorageStatePath(dataDir: string): string {
  return join(dataDir, 'browser', 'storage-state.json')
}

export function snapshotIdFor(tabId: number, seq: number): string {
  return `t${tabId}s${seq}`
}

export function serializeEvaluateResult(
  value: unknown,
  maxChars = EVALUATE_MAX_CHARS,
): { result: unknown; truncated: boolean } {
  let text: string
  try {
    text = JSON.stringify(value) ?? 'null'
  } catch {
    text = JSON.stringify(String(value))
  }
  if (text.length <= maxChars) {
    try {
      return { result: JSON.parse(text), truncated: false }
    } catch {
      return { result: text, truncated: false }
    }
  }
  return { result: text.slice(0, maxChars), truncated: true }
}

/**
 * Playwright treats a string pageFunction as an *expression* (`isFunction: false`),
 * not as a function to invoke. `() => { ... }` therefore returns undefined
 * (functions are not serializable). Call the source as an IIFE, and inline the
 * argument — a second evaluate arg is ignored for string expressions.
 */
function evalSource(page: any, source: string, arg?: unknown): Promise<unknown> {
  if (arg === undefined) return page.evaluate(`(${source})()`)
  return page.evaluate(`(${source})(${JSON.stringify(arg)})`)
}

function clampTimeout(ms: unknown, fallback: number, max: number): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return fallback
  return Math.min(Math.floor(ms), max)
}

function resolveTarget(target: BrowserTarget, tab: TabState): string {
  const hasSelector = typeof target.selector === 'string' && target.selector.length > 0
  const hasIndex = typeof target.index === 'number'
  if (hasSelector === hasIndex) {
    throw new Error('Provide exactly one of selector or index (from the last browser_snapshot)')
  }
  const currentId = snapshotIdFor(tab.id, tab.snapshotSeq)
  if (target.snapshotId && target.snapshotId !== currentId) {
    throw new Error(STALE_SNAPSHOT_MESSAGE)
  }
  if (hasIndex) {
    if (tab.lastSnapshotSeq === null || tab.lastSnapshotSeq !== tab.snapshotSeq) {
      throw new Error(STALE_SNAPSHOT_MESSAGE)
    }
    return indexSelector(target.index as number)
  }
  return target.selector as string
}

function isMainFrame(page: any, frame: any): boolean {
  if (!frame) return true
  if (typeof page.mainFrame === 'function') {
    try {
      if (frame === page.mainFrame()) return true
    } catch {
      /* ignore */
    }
  }
  if (typeof frame.parentFrame === 'function') {
    try {
      return frame.parentFrame() === null
    } catch {
      return true
    }
  }
  return true
}

function safeFilename(name: string): string {
  const base = basename(name).replace(/[^A-Za-z0-9._-]+/g, '_')
  return base || `download-${Date.now()}`
}

export function createBrowserSessionManager(config: BrowserSessionConfig = {}) {
  const maxDuration = config.maxSessionDurationMs ?? 300_000 // 5 min
  const headless = config.headless ?? true
  const urlAllowlist = config.urlAllowlist ?? DEFAULT_URL_ALLOWLIST
  const allowPrivate = config.allowPrivateHosts ?? false
  const persistProfile = config.persistProfile ?? true
  const dataDir = config.dataDir ?? resolveInstance({ ensureDirs: false }).dataDir
  const envProfile = (process.env.EYAS_BROWSER_USER_DATA_DIR ?? '').trim()
  const userDataDir = config.userDataDir ?? (envProfile || defaultBrowserUserDataDir(dataDir))
  const storageStatePath = config.storageStatePath ?? defaultBrowserStorageStatePath(dataDir)
  let session: LiveSession | null = null
  let pendingStorageState: string | null = null
  let dialogPlan: { action: 'accept' | 'dismiss'; promptText?: string } | null = null

  function isUrlAllowed(url: string): boolean {
    assertSafeBrowserUrl(url, allowPrivate)
    if (urlAllowlist.length === 0) return true
    return urlAllowlist.some((pattern) => pattern.test(url))
  }

  function isSessionExpired(): boolean {
    if (!session) return true
    return Date.now() - session.startedAt > maxDuration
  }

  function requireActiveTab(): TabState {
    if (!session) throw new Error('No active browser session')
    const tab = session.tabs.get(session.activeTabId)
    if (!tab || tab.page?.isClosed?.()) throw new Error('No active browser tab')
    return tab
  }

  function invalidateSnapshot(tab: TabState): void {
    tab.snapshotSeq += 1
    tab.lastSnapshotSeq = null
  }

  function attachPage(tab: TabState): void {
    const page = tab.page
    if (typeof page.on !== 'function') return
    page.on('framenavigated', (frame: any) => {
      if (isMainFrame(page, frame)) invalidateSnapshot(tab)
    })
    page.on('dialog', async (dialog: any) => {
      const plan = dialogPlan
      dialogPlan = null
      try {
        if (plan?.action === 'dismiss') await dialog.dismiss()
        else await dialog.accept(plan?.promptText)
      } catch {
        /* dialog already handled or page closed */
      }
    })
  }

  function adoptPage(page: any): TabState {
    if (!session) throw new Error('No active browser session')
    const tab: TabState = {
      id: session.nextTabId++,
      page,
      snapshotSeq: 0,
      lastSnapshotSeq: null,
    }
    session.tabs.set(tab.id, tab)
    attachPage(tab)
    return tab
  }

  async function openBrowser(): Promise<{ browser: any; context: any; page: any; persistent: boolean }> {
    if (config.launch) {
      const opened = await config.launch()
      return { ...opened, persistent: persistProfile }
    }

    const storageState =
      pendingStorageState && existsSync(pendingStorageState)
        ? pendingStorageState
        : !persistProfile && existsSync(storageStatePath)
          ? storageStatePath
          : undefined
    pendingStorageState = null

    const contextOptions: Record<string, unknown> = {
      viewport: VIEWPORT,
      userAgent: USER_AGENT,
      acceptDownloads: true,
    }
    if (storageState) contextOptions.storageState = storageState

    if (persistProfile) {
      assertEyAsUserDataDir(userDataDir)
      await mkdir(userDataDir, { recursive: true })
      const context = await launchPersistentChromium(userDataDir, {
        headless,
        extraContextOptions: contextOptions,
      })
      const browser = typeof context.browser === 'function' ? context.browser() : context
      const existing = typeof context.pages === 'function' ? context.pages() : []
      const page = existing[0] ?? (await context.newPage())
      return { browser, context, page, persistent: true }
    }

    const browser = await launchChromium({ headless })
    const context = await browser.newContext(contextOptions)
    const page = await context.newPage()
    return { browser, context, page, persistent: false }
  }

  const manager = {
    async getOrCreateSession(): Promise<BrowserSession> {
      if (session && !isSessionExpired()) {
        session.lastActionAt = Date.now()
        const tab = session.tabs.get(session.activeTabId)
        if (tab) session.page = tab.page
        return session
      }

      if (session) await manager.close()

      const opened = await openBrowser()
      const live: LiveSession = {
        page: opened.page,
        browser: opened.browser,
        context: opened.context,
        startedAt: Date.now(),
        lastActionAt: Date.now(),
        tabs: new Map(),
        activeTabId: 0,
        nextTabId: 1,
        persistent: opened.persistent,
      }
      session = live
      const tab = adoptPage(opened.page)
      live.activeTabId = tab.id
      live.page = tab.page
      return live
    },

    async navigate(url: string): Promise<{ title: string; url: string }> {
      if (!isUrlAllowed(url)) {
        throw new Error(`URL not allowed by policy: ${url}`)
      }
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      await tab.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      invalidateSnapshot(tab)
      return { title: await tab.page.title(), url: tab.page.url() }
    },

    async click(target: BrowserTarget): Promise<{ success: boolean; selector: string }> {
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const selector = resolveTarget(target, tab)
      await tab.page.click(selector, { timeout: 10_000 })
      return { success: true, selector }
    },

    async currentUrl(): Promise<{ url: string; origin: string }> {
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const url = typeof tab.page.url === 'function' ? tab.page.url() : String(tab.page.url ?? '')
      return { url, origin: new URL(url).origin }
    },

    async durableLocator(target: BrowserTarget): Promise<DurableLocator> {
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const selector = resolveTarget(target, tab)
      let extracted: DurableLocator | null = null
      try {
        const raw = await evalSource(tab.page, EXTRACT_LOCATOR_JS, selector)
        if (raw && typeof raw === 'object' && (raw as DurableLocator).kind) {
          extracted = raw as DurableLocator
        }
      } catch {
        /* page may not be a document */
      }
      const fallback = extracted ?? fallbackDurableLocator(selector)
      if (!fallback) {
        throw new Error('No durable locator (id, name, test id, or role+name). Indexes are not cached.')
      }
      return fallback
    },

    async actByLocator(
      action: CacheableAction,
      locator: DurableLocator,
      extra?: { value?: string; values?: string | string[] },
    ): Promise<{ success: boolean; selector?: string; action: CacheableAction }> {
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const timeout = { timeout: 10_000 }
      if (locator.kind === 'css') {
        if (action === 'click') await tab.page.click(locator.value, timeout)
        else if (action === 'fill') {
          if (typeof extra?.value !== 'string') throw new Error('fill requires value')
          await tab.page.fill(locator.value, extra.value, timeout)
        } else if (action === 'hover') await tab.page.hover(locator.value, timeout)
        else {
          const list = Array.isArray(extra?.values) ? extra!.values : extra?.values ? [extra.values] : extra?.value ? [extra.value] : []
          if (!list.length) throw new Error('select requires values')
          await tab.page.selectOption(locator.value, list, timeout)
        }
        return { success: true, selector: locator.value, action }
      }
      const handle =
        typeof tab.page.getByRole === 'function'
          ? tab.page.getByRole(locator.role, { name: locator.name })
          : tab.page.locator?.(`${locator.role}:has-text(${JSON.stringify(locator.name)})`)
      if (!handle) throw new Error('Role locators need Playwright getByRole')
      if (action === 'click') await handle.click(timeout)
      else if (action === 'fill') {
        if (typeof extra?.value !== 'string') throw new Error('fill requires value')
        await handle.fill(extra.value, timeout)
      } else if (action === 'hover') await handle.hover(timeout)
      else {
        const list = Array.isArray(extra?.values) ? extra!.values : extra?.values ? [extra.values] : extra?.value ? [extra.value] : []
        if (!list.length) throw new Error('select requires values')
        await handle.selectOption(list, timeout)
      }
      return { success: true, action }
    },

    async fill(target: BrowserTarget, value: string): Promise<{ success: boolean; selector: string }> {
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const selector = resolveTarget(target, tab)
      await tab.page.fill(selector, value, { timeout: 10_000 })
      return { success: true, selector }
    },

    async hover(target: BrowserTarget): Promise<{ success: boolean; selector: string }> {
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const selector = resolveTarget(target, tab)
      await tab.page.hover(selector, { timeout: 10_000 })
      return { success: true, selector }
    },

    async select(
      target: BrowserTarget,
      values: string | string[],
    ): Promise<{ success: boolean; selector: string; values: string[] }> {
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const selector = resolveTarget(target, tab)
      const list = Array.isArray(values) ? values : [values]
      await tab.page.selectOption(selector, list, { timeout: 10_000 })
      return { success: true, selector, values: list }
    },

    async screenshot(): Promise<{ base64: string; path?: string }> {
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const buffer = await tab.page.screenshot({ type: 'png', fullPage: false })
      const base64 = Buffer.from(buffer).toString('base64')

      let path: string | undefined
      if (config.screenshotDir) {
        await mkdir(config.screenshotDir, { recursive: true })
        path = `${config.screenshotDir}/screenshot-${Date.now()}.png`
        await writeFile(path, buffer)
      }

      return { base64, path }
    },

    async getContent(): Promise<{ title: string; url: string; text: string }> {
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const text = await tab.page.evaluate(() => document.body.innerText)
      return {
        title: await tab.page.title(),
        url: tab.page.url(),
        text: String(text ?? '').slice(0, 5000),
      }
    },

    /**
     * Accessibility-tree snapshot plus numbered interactive elements.
     * Prefer click/fill by `index` from `elements` over CSS selectors.
     */
    async snapshot(maxChars = 12_000): Promise<{
      title: string
      url: string
      snapshot: string
      elements: InteractiveElement[]
      interactive: string
      snapshotId: string
      tabId: number
    }> {
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const page = tab.page
      let snapshot = ''
      try {
        if (typeof page.locator === 'function' && page.locator('body').ariaSnapshot) {
          snapshot = await page.locator('body').ariaSnapshot()
        }
      } catch {
        /* fall through */
      }
      if (!snapshot) {
        snapshot = await page.evaluate(() => {
          const walk = (el: Element, depth: number): string => {
            if (depth > 8) return ''
            const role = el.getAttribute('role') || el.tagName.toLowerCase()
            const name =
              el.getAttribute('aria-label') ||
              (el as HTMLElement).innerText?.slice(0, 80)?.replace(/\s+/g, ' ') ||
              ''
            const line = `${'  '.repeat(depth)}- ${role}${name ? `: ${name.trim()}` : ''}`
            const kids = Array.from(el.children)
              .slice(0, 40)
              .map((c) => walk(c, depth + 1))
              .filter(Boolean)
            return [line, ...kids].join('\n')
          }
          return walk(document.body, 0)
        })
      }
      let elements: InteractiveElement[] = []
      try {
        const stamped = await evalSource(page, STAMP_INTERACTIVE_JS)
        if (Array.isArray(stamped)) elements = stamped as InteractiveElement[]
      } catch {
        /* page may not be a document */
      }
      tab.lastSnapshotSeq = tab.snapshotSeq
      const snapshotId = snapshotIdFor(tab.id, tab.snapshotSeq)
      const interactive = formatInteractiveSnapshot(elements)
      return {
        title: await page.title(),
        url: page.url(),
        snapshot: String(snapshot).slice(0, maxChars),
        elements,
        interactive,
        snapshotId,
        tabId: tab.id,
      }
    },

    async back(): Promise<{ title: string; url: string }> {
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      await tab.page.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 })
      invalidateSnapshot(tab)
      return { title: await tab.page.title(), url: tab.page.url() }
    },

    async wait(input: {
      kind: 'selector' | 'timeout' | 'url' | 'load'
      selector?: string
      index?: number
      snapshotId?: string
      url?: string
      timeoutMs?: number
      loadState?: 'load' | 'domcontentloaded' | 'networkidle'
    }): Promise<{ waited: string }> {
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const page = tab.page
      if (input.kind === 'timeout') {
        const ms = clampTimeout(input.timeoutMs, 1_000, WAIT_TIMEOUT_KIND_MAX_MS)
        if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(ms)
        else await new Promise((r) => setTimeout(r, ms))
        return { waited: `timeout:${ms}` }
      }
      const timeout = clampTimeout(input.timeoutMs, 10_000, WAIT_MAX_MS)
      if (input.kind === 'load') {
        const state = input.loadState ?? 'domcontentloaded'
        await page.waitForLoadState(state, { timeout })
        return { waited: `load:${state}` }
      }
      if (input.kind === 'url') {
        if (!input.url) throw new Error('wait kind=url requires url')
        isUrlAllowed(input.url)
        await page.waitForURL(input.url, { timeout, waitUntil: 'domcontentloaded' })
        return { waited: `url:${input.url}` }
      }
      const selector = resolveTarget(
        { selector: input.selector, index: input.index, snapshotId: input.snapshotId },
        tab,
      )
      await page.waitForSelector(selector, { timeout })
      return { waited: `selector:${selector}` }
    },

    armDialog(action: 'accept' | 'dismiss', promptText?: string): { armed: string } {
      dialogPlan = { action, promptText }
      return { armed: action }
    },

    async upload(target: BrowserTarget, files: string[]): Promise<{ success: boolean; selector: string; files: number }> {
      if (!files.length) throw new Error('upload requires at least one file path')
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const selector = resolveTarget(target, tab)
      await tab.page.setInputFiles(selector, files, { timeout: 15_000 })
      return { success: true, selector, files: files.length }
    },

    async evaluate(expression: string): Promise<{ result: unknown; truncated: boolean }> {
      if (typeof expression !== 'string' || expression.trim() === '') {
        throw new Error('evaluate requires a JavaScript expression')
      }
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const value = await tab.page.evaluate((expr: string) => (0, eval)(expr), expression)
      return serializeEvaluateResult(value)
    },

    async download(
      target: BrowserTarget | undefined,
      meta: { timeoutMs?: number; conversationId?: string; userId?: string } = {},
    ): Promise<{
      filename: string
      ingested: boolean
      documentId?: string
      sizeBytes?: number
      savedPath?: string
      reason?: string
    }> {
      await manager.getOrCreateSession()
      const tab = requireActiveTab()
      const timeout = clampTimeout(meta.timeoutMs, 15_000, WAIT_MAX_MS)
      const waiter = tab.page.waitForEvent('download', { timeout })
      const hasTarget =
        (typeof target?.selector === 'string' && target.selector.length > 0) ||
        typeof target?.index === 'number'
      if (hasTarget && target) {
        await manager.click(target)
      }
      const download = await waiter
      const filename = safeFilename(
        (typeof download.suggestedFilename === 'function' ? download.suggestedFilename() : '') ||
          `download-${Date.now()}`,
      )
      const dir = join(dataDir, 'browser', 'downloads')
      await mkdir(dir, { recursive: true })
      const dest = join(dir, `${Date.now()}-${filename}`)
      await download.saveAs(dest)
      const file = await readFile(dest)
      if (file.length > DOWNLOAD_MAX_BYTES) {
        throw new Error(`download ${file.length} bytes exceeds the ${DOWNLOAD_MAX_BYTES} byte cap`)
      }
      const docs = config.getDocuments?.()
      if (!docs?.upload) {
        return {
          filename,
          ingested: false,
          savedPath: dest,
          sizeBytes: file.length,
          reason: 'Documents module not ready — file kept under data/browser/downloads',
        }
      }
      const doc = await docs.upload({
        file,
        filename,
        createdBy: meta.userId ?? 'agent',
        metadata: { source: 'browser_download', pageUrl: tab.page.url() },
        module: 'tools',
      })
      if (meta.conversationId && typeof docs.link === 'function') {
        docs.link(doc.id, 'conversations', meta.conversationId, 'ai')
      }
      try {
        await unlink(dest)
      } catch {
        /* keep if unlink fails */
      }
      return { filename, ingested: true, documentId: doc.id, sizeBytes: file.length }
    },

    async tabs(): Promise<{ tabs: BrowserTabInfo[]; activeTabId: number }> {
      await manager.getOrCreateSession()
      const list: BrowserTabInfo[] = []
      for (const tab of session!.tabs.values()) {
        if (tab.page?.isClosed?.()) continue
        list.push({
          id: tab.id,
          url: typeof tab.page.url === 'function' ? tab.page.url() : '',
          title: await tab.page.title(),
          active: tab.id === session!.activeTabId,
          snapshotId: tab.lastSnapshotSeq === tab.snapshotSeq ? snapshotIdFor(tab.id, tab.snapshotSeq) : null,
        })
      }
      return { tabs: list, activeTabId: session!.activeTabId }
    },

    async openTab(url?: string): Promise<{ tabId: number; title: string; url: string }> {
      if (url) isUrlAllowed(url)
      await manager.getOrCreateSession()
      const page = await session!.context.newPage()
      const tab = adoptPage(page)
      session!.activeTabId = tab.id
      session!.page = page
      if (url) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        invalidateSnapshot(tab)
      }
      return { tabId: tab.id, title: await page.title(), url: page.url() }
    },

    async switchTab(id: number): Promise<{ tabId: number; title: string; url: string }> {
      await manager.getOrCreateSession()
      const tab = session!.tabs.get(id)
      if (!tab || tab.page?.isClosed?.()) throw new Error(`No browser tab with id ${id}`)
      if (typeof tab.page.bringToFront === 'function') await tab.page.bringToFront()
      session!.activeTabId = tab.id
      session!.page = tab.page
      session!.lastActionAt = Date.now()
      return { tabId: tab.id, title: await tab.page.title(), url: tab.page.url() }
    },

    async closeTab(id: number): Promise<{ closed: number; activeTabId: number }> {
      await manager.getOrCreateSession()
      const open = [...session!.tabs.values()].filter((t) => !t.page?.isClosed?.())
      if (open.length <= 1) {
        throw new Error('Cannot close the last tab; use browser_close to end the session')
      }
      const tab = session!.tabs.get(id)
      if (!tab) throw new Error(`No browser tab with id ${id}`)
      try {
        await tab.page.close()
      } catch {
        /* already closed */
      }
      session!.tabs.delete(id)
      if (session!.activeTabId === id) {
        const next = [...session!.tabs.values()].find((t) => !t.page?.isClosed?.())
        if (!next) throw new Error('No browser tab remaining')
        session!.activeTabId = next.id
        session!.page = next.page
        if (typeof next.page.bringToFront === 'function') await next.page.bringToFront()
      }
      return { closed: id, activeTabId: session!.activeTabId }
    },

    async saveStorageState(path?: string): Promise<{ path: string }> {
      await manager.getOrCreateSession()
      const dest = path ?? storageStatePath
      await mkdir(dirname(dest), { recursive: true })
      await session!.context.storageState({ path: dest })
      return { path: dest }
    },

    async loadStorageState(path?: string): Promise<{ loaded: boolean; path: string }> {
      const src = path ?? storageStatePath
      if (!existsSync(src)) throw new Error(`storageState file not found: ${src}`)
      pendingStorageState = src
      if (session) await manager.close()
      await manager.getOrCreateSession()
      return { loaded: true, path: src }
    },

    async close(): Promise<void> {
      if (!session) return
      const current = session
      session = null
      dialogPlan = null
      try {
        if (current.persistent && typeof current.context?.close === 'function') {
          await current.context.close()
        } else if (typeof current.browser?.close === 'function') {
          await current.browser.close()
        }
      } catch {
        // Ignore close errors
      }
    },

    isActive(): boolean {
      return session !== null && !isSessionExpired()
    },
  }

  return manager
}
