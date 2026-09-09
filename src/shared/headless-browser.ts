// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/shared/headless-browser.ts
//
// A single Chromium, borrowed a page at a time.
//
// One feature needs a browser — printing a design canvas
// out of a live page — and both are occasional. Launching per request costs
// half a second; holding a browser open forever costs a self-hosted box a
// couple of hundred megabytes for nothing. So: launch on first use, keep it
// while work keeps arriving, close it when it has been idle.
//
// EVERY page is created in its own throwaway BrowserContext with all network
// aborted by default. That default is the security property the design print
// path leans on: unlike the canvas preview, a print page is not in a sandboxed
// iframe, so the fence has to be somewhere else, and the browser process is a
// better place for it than a meta tag.

import { isPrivateOrLocalHost } from './net-guard.js'
import { BrowserUnavailableError, launchChromium } from './playwright-loader.js'

export interface PageOptions {
  viewport?: { width: number; height: number }
  /** Context-level. Playwright ignores this on screenshot(); a @2x export needs it here. */
  deviceScaleFactor?: number
  /** Exact origins that may load. Everything else is aborted in the browser process. */
  allowOrigins?: string[]
  /**
   * Let the page reach the public web — for probing a real site, where the CSS
   * and the fonts are routinely on origins we cannot know in advance. Private,
   * loopback and link-local addresses stay blocked, so a page cannot use a
   * sub-resource to reach the host's own network or a cloud metadata endpoint.
   */
  allowPublicHttp?: boolean
  /** Applied to navigation and to the default action timeout. */
  timeoutMs?: number
}

export interface BrowserStatus {
  available: boolean
  reason?: string
  remediation?: string
}

export interface HeadlessBrowser {
  withPage<T>(opts: PageOptions, fn: (page: any) => Promise<T>): Promise<T>
  status(): Promise<BrowserStatus>
  close(): Promise<void>
}

export interface HeadlessBrowserOptions {
  /** Injected for tests; production uses the shared loader. */
  launch?: () => Promise<any>
  /** Close the browser after this long with no page in flight. */
  idleMs?: number
  /** How long a failed probe is trusted before trying again. */
  failureCacheMs?: number
}

/** Schemes the document is built out of; blocking them blocks the page itself. */
const ALWAYS_ALLOWED = ['about:', 'data:', 'blob:']

export function requestAllowed(url: string, opts: Pick<PageOptions, 'allowOrigins' | 'allowPublicHttp'>): boolean {
  if (ALWAYS_ALLOWED.some((scheme) => url.startsWith(scheme))) return true
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  // Compare parsed origins, never prefixes: `https://fonts.googleapis.com`
  // is a prefix of `https://fonts.googleapis.com.evil.test`.
  if ((opts.allowOrigins ?? []).includes(parsed.origin)) return true
  if (!opts.allowPublicHttp) return false
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return !isPrivateOrLocalHost(parsed.hostname)
}

export function createHeadlessBrowser(options: HeadlessBrowserOptions = {}): HeadlessBrowser {
  const launch = options.launch ?? (() => launchChromium())
  const idleMs = options.idleMs ?? 60_000
  const failureCacheMs = options.failureCacheMs ?? 30_000

  let browser: any = null
  let launching: Promise<any> | null = null
  let inFlight = 0
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let lastFailure: { at: number; error: BrowserUnavailableError } | null = null

  function clearIdleTimer(): void {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  function armIdleTimer(): void {
    clearIdleTimer()
    if (!browser || inFlight > 0) return
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (inFlight === 0) void shutdown()
    }, idleMs)
    // Without unref the timer keeps the process (and `bun vitest`) alive.
    idleTimer.unref?.()
  }

  async function shutdown(): Promise<void> {
    const current = browser
    browser = null
    launching = null
    clearIdleTimer()
    if (!current) return
    try {
      await current.close()
    } catch {
      // A browser that died on its own is already in the state we wanted.
    }
  }

  async function acquire(): Promise<any> {
    if (browser) {
      // A browser can be killed out from under us (OOM, a crashed tab).
      if (typeof browser.isConnected !== 'function' || browser.isConnected()) return browser
      browser = null
    }
    if (!launching) {
      launching = launch()
        .then((b) => {
          browser = b
          lastFailure = null
          return b
        })
        .catch((err) => {
          const wrapped =
            err instanceof BrowserUnavailableError
              ? err
              : new BrowserUnavailableError(err instanceof Error ? err.message : String(err))
          lastFailure = { at: Date.now(), error: wrapped }
          throw wrapped
        })
        .finally(() => {
          launching = null
        })
    }
    return launching
  }

  return {
    async status() {
      if (browser) return { available: true }
      if (lastFailure && Date.now() - lastFailure.at < failureCacheMs) {
        return { available: false, reason: lastFailure.error.message, remediation: lastFailure.error.remediation }
      }
      try {
        await acquire()
        armIdleTimer()
        return { available: true }
      } catch (err) {
        const e = err as BrowserUnavailableError
        return { available: false, reason: e.message, remediation: e.remediation }
      }
    },

    async withPage(opts, fn) {
      clearIdleTimer()
      inFlight++
      let context: any = null
      try {
        const b = await acquire()
        context = await b.newContext({
          ...(opts.viewport ? { viewport: opts.viewport } : {}),
          ...(opts.deviceScaleFactor ? { deviceScaleFactor: opts.deviceScaleFactor } : {}),
          javaScriptEnabled: true,
        })
        await context.route('**/*', (route: any) => {
          const url = route.request().url()
          return requestAllowed(url, opts) ? route.continue() : route.abort()
        })
        const page = await context.newPage()
        if (opts.timeoutMs) page.setDefaultTimeout?.(opts.timeoutMs)
        return await fn(page)
      } finally {
        if (context) {
          try {
            await context.close()
          } catch {
            // The context dying is the outcome we wanted anyway.
          }
        }
        inFlight--
        armIdleTimer()
      }
    },

    close: shutdown,
  }
}

let shared: HeadlessBrowser | null = null

/**
 * The process-wide instance. Two modules use it; making them each own one would
 * mean two Chromiums for a machine that struggles to afford the first.
 */
export function sharedHeadlessBrowser(): HeadlessBrowser {
  if (!shared) shared = createHeadlessBrowser()
  return shared
}

export async function closeSharedHeadlessBrowser(): Promise<void> {
  const current = shared
  shared = null
  if (current) await current.close()
}
