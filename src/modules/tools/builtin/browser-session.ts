// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Browser session manager using Playwright.
 * Manages browser lifecycle, page state, URL allowlists, and session timeouts.
 *
 * Playwright is a peer dependency — dynamically imported to avoid failures when not installed.
 */

export interface BrowserSessionConfig {
  urlAllowlist?: RegExp[] // Allowed URL patterns (empty = allow all)
  maxSessionDurationMs?: number // Default: 5 minutes
  headless?: boolean // Default: true
  screenshotDir?: string // Where to save screenshots
}

export interface BrowserSession {
  page: any // playwright.Page
  browser: any // playwright.Browser
  context: any // playwright.BrowserContext
  startedAt: number
  lastActionAt: number
}

const DEFAULT_URL_ALLOWLIST: RegExp[] = [
  /^https?:\/\/.*/, // Allow all HTTP(S) by default — restrict via config
]

export function createBrowserSessionManager(config: BrowserSessionConfig = {}) {
  const maxDuration = config.maxSessionDurationMs ?? 300_000 // 5 min
  const headless = config.headless ?? true
  const urlAllowlist = config.urlAllowlist ?? DEFAULT_URL_ALLOWLIST
  let session: BrowserSession | null = null
  let playwright: any = null

  async function ensurePlaywright() {
    if (playwright) return playwright
    try {
      playwright = await import('playwright')
      return playwright
    } catch {
      throw new Error('Playwright is not installed. Run: bun add playwright')
    }
  }

  function isUrlAllowed(url: string): boolean {
    if (urlAllowlist.length === 0) return true
    return urlAllowlist.some((pattern) => pattern.test(url))
  }

  function isSessionExpired(): boolean {
    if (!session) return true
    return Date.now() - session.startedAt > maxDuration
  }

  const manager = {
    async getOrCreateSession(): Promise<BrowserSession> {
      if (session && !isSessionExpired()) {
        session.lastActionAt = Date.now()
        return session
      }

      // Close expired session
      if (session) await manager.close()

      const pw = await ensurePlaywright()
      const browser = await pw.chromium.launch({ headless })
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'EYAS/1.0 Browser Agent',
      })
      const page = await context.newPage()

      session = {
        page,
        browser,
        context,
        startedAt: Date.now(),
        lastActionAt: Date.now(),
      }
      return session
    },

    async navigate(url: string): Promise<{ title: string; url: string }> {
      if (!isUrlAllowed(url)) {
        throw new Error(`URL not allowed by policy: ${url}`)
      }
      const { page } = await manager.getOrCreateSession()
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      return { title: await page.title(), url: page.url() }
    },

    async click(selector: string): Promise<{ success: boolean }> {
      const { page } = await manager.getOrCreateSession()
      await page.click(selector, { timeout: 10_000 })
      return { success: true }
    },

    async fill(
      selector: string,
      value: string,
    ): Promise<{ success: boolean }> {
      const { page } = await manager.getOrCreateSession()
      await page.fill(selector, value, { timeout: 10_000 })
      return { success: true }
    },

    async screenshot(): Promise<{ base64: string; path?: string }> {
      const { page } = await manager.getOrCreateSession()
      const buffer = await page.screenshot({ type: 'png', fullPage: false })
      const base64 = Buffer.from(buffer).toString('base64')

      // Optionally save to disk
      let path: string | undefined
      if (config.screenshotDir) {
        const { writeFile, mkdir } = await import('fs/promises')
        await mkdir(config.screenshotDir, { recursive: true })
        path = `${config.screenshotDir}/screenshot-${Date.now()}.png`
        await writeFile(path, buffer)
      }

      return { base64, path }
    },

    async getContent(): Promise<{ title: string; url: string; text: string }> {
      const { page } = await manager.getOrCreateSession()
      const text = await page.evaluate(() => document.body.innerText)
      return {
        title: await page.title(),
        url: page.url(),
        text: text.slice(0, 5000),
      }
    },

    async close(): Promise<void> {
      if (session) {
        try {
          await session.browser.close()
        } catch {
          // Ignore close errors
        }
        session = null
      }
    },

    isActive(): boolean {
      return session !== null && !isSessionExpired()
    },
  }

  return manager
}
