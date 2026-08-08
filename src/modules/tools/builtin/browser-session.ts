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

/** Wave 2 — block SSRF to private/link-local/metadata addresses. */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '::') return true
  if (h.endsWith('.local') || h.endsWith('.internal')) return true
  // IPv4 private / loopback / link-local / CGNAT
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  }
  // IPv6 ULA / link-local
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true
  return false
}

export function assertSafeBrowserUrl(url: string, allowPrivate = false): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`URL scheme not allowed: ${parsed.protocol}`)
  }
  if (!allowPrivate && isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error(`SSRF blocked: private/local host not allowed (${parsed.hostname})`)
  }
}

export function createBrowserSessionManager(config: BrowserSessionConfig & { allowPrivateHosts?: boolean } = {}) {
  const maxDuration = config.maxSessionDurationMs ?? 300_000 // 5 min
  const headless = config.headless ?? true
  const urlAllowlist = config.urlAllowlist ?? DEFAULT_URL_ALLOWLIST
  const allowPrivate = config.allowPrivateHosts ?? false
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
    assertSafeBrowserUrl(url, allowPrivate)
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

    /**
     * Accessibility-tree snapshot — far cheaper than full HTML/screenshots for agents.
     */
    async snapshot(maxChars = 12_000): Promise<{ title: string; url: string; snapshot: string }> {
      const { page } = await manager.getOrCreateSession()
      let snapshot = ''
      try {
        // Playwright's aria snapshot when available
        if (typeof page.locator === 'function' && page.locator('body').ariaSnapshot) {
          snapshot = await page.locator('body').ariaSnapshot()
        }
      } catch { /* fall through */ }
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
      return {
        title: await page.title(),
        url: page.url(),
        snapshot: String(snapshot).slice(0, maxChars),
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
