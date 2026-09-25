// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHeadlessBrowser } from '@shared/headless-browser'
import { BrowserUnavailableError } from '@shared/playwright-loader'

interface FakeRoute {
  url: string
  continued: boolean
  aborted: boolean
}

function fakeBrowser() {
  const routes: Array<(route: any) => any> = []
  const contexts: any[] = []
  const closed = { browser: 0 }
  const browser = {
    async newContext(opts: any) {
      const ctx: any = {
        opts,
        closed: 0,
        async route(_pattern: string, handler: (route: any) => any) { routes.push(handler) },
        async newPage() {
          return { setContent: vi.fn(), close: vi.fn() }
        },
        async close() { ctx.closed++ },
      }
      contexts.push(ctx)
      return ctx
    },
    async close() { closed.browser++ },
    isConnected() { return closed.browser === 0 },
  }
  return { browser, routes, contexts, closed }
}

function callRoute(handler: (route: any) => any, url: string): FakeRoute {
  const state: FakeRoute = { url, continued: false, aborted: false }
  handler({
    request: () => ({ url: () => url }),
    continue: async () => { state.continued = true },
    abort: async () => { state.aborted = true },
  })
  return state
}

describe('createHeadlessBrowser — availability', () => {
  it('reports unavailable with the remediation instead of throwing on status()', async () => {
    const hb = createHeadlessBrowser({
      launch: async () => { throw new BrowserUnavailableError('nothing here', 'install one') },
    })
    const status = await hb.status()
    expect(status.available).toBe(false)
    expect(status.reason).toContain('nothing here')
    expect(status.remediation).toBe('install one')
  })

  it('still throws from withPage, because a caller that wanted a page needs to fail', async () => {
    const hb = createHeadlessBrowser({
      launch: async () => { throw new BrowserUnavailableError('nothing here') },
    })
    await expect(hb.withPage({}, async () => 'never')).rejects.toBeInstanceOf(BrowserUnavailableError)
  })

  it('does not cache a failure forever — a browser installed later is picked up', async () => {
    vi.useFakeTimers()
    const { browser } = fakeBrowser()
    let attempt = 0
    const hb = createHeadlessBrowser({
      launch: async () => {
        attempt++
        if (attempt === 1) throw new BrowserUnavailableError('not yet')
        return browser
      },
      failureCacheMs: 30_000,
    })
    expect((await hb.status()).available).toBe(false)
    expect((await hb.status()).available).toBe(false) // cached, no second attempt
    expect(attempt).toBe(1)
    vi.advanceTimersByTime(31_000)
    expect((await hb.status()).available).toBe(true)
    await hb.close()
    vi.useRealTimers()
  })
})

describe('createHeadlessBrowser — pages', () => {
  it('applies the viewport and device scale factor to the context, not the screenshot', async () => {
    // deviceScaleFactor is a BrowserContext option in Playwright. Passing it to
    // screenshot() is silently ignored, which is how a @2x export ships at 1x.
    const { browser, contexts } = fakeBrowser()
    const hb = createHeadlessBrowser({ launch: async () => browser })
    await hb.withPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 2 }, async () => 'ok')
    expect(contexts[0].opts).toMatchObject({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 2 })
    await hb.close()
  })

  it('closes the context even when the caller throws', async () => {
    const { browser, contexts } = fakeBrowser()
    const hb = createHeadlessBrowser({ launch: async () => browser })
    await expect(hb.withPage({}, async () => { throw new Error('render blew up') })).rejects.toThrow('render blew up')
    expect(contexts[0].closed).toBe(1)
    await hb.close()
  })

  it('shares one launch between concurrent callers', async () => {
    const { browser } = fakeBrowser()
    const launch = vi.fn(async () => browser)
    const hb = createHeadlessBrowser({ launch })
    await Promise.all([hb.withPage({}, async () => 1), hb.withPage({}, async () => 2), hb.withPage({}, async () => 3)])
    expect(launch).toHaveBeenCalledTimes(1)
    await hb.close()
  })
})

describe('createHeadlessBrowser — the network fence', () => {
  let hb: ReturnType<typeof createHeadlessBrowser>
  let harness: ReturnType<typeof fakeBrowser>

  beforeEach(async () => {
    harness = fakeBrowser()
    hb = createHeadlessBrowser({ launch: async () => harness.browser })
  })
  afterEach(async () => { await hb.close() })

  it('aborts everything by default — the page renders from its own bytes', async () => {
    await hb.withPage({}, async () => 'ok')
    const handler = harness.routes[0]
    expect(callRoute(handler, 'https://evil.example/beacon?token=abc').aborted).toBe(true)
    expect(callRoute(handler, 'http://169.254.169.254/latest/meta-data/').aborted).toBe(true)
  })

  it('lets through only the origins the caller named', async () => {
    await hb.withPage({ allowOrigins: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'] }, async () => 'ok')
    const handler = harness.routes[0]
    expect(callRoute(handler, 'https://fonts.googleapis.com/css2?family=Inter').continued).toBe(true)
    expect(callRoute(handler, 'https://fonts.gstatic.com/s/inter/v1/a.woff2').continued).toBe(true)
    expect(callRoute(handler, 'https://fonts.googleapis.com.evil.test/x').aborted).toBe(true)
    expect(callRoute(handler, 'https://other.example/x').aborted).toBe(true)
  })

  it('always allows the schemes the document itself is made of', async () => {
    await hb.withPage({}, async () => 'ok')
    const handler = harness.routes[0]
    expect(callRoute(handler, 'about:blank').continued).toBe(true)
    expect(callRoute(handler, 'data:image/png;base64,AAAA').continued).toBe(true)
    expect(callRoute(handler, 'blob:null/1234').continued).toBe(true)
  })
})

describe('createHeadlessBrowser — lifecycle', () => {
  it('closes an idle browser so a self-hosted box is not holding Chromium open', async () => {
    vi.useFakeTimers()
    const harness = fakeBrowser()
    const hb = createHeadlessBrowser({ launch: async () => harness.browser, idleMs: 5_000 })
    await hb.withPage({}, async () => 'ok')
    expect(harness.closed.browser).toBe(0)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(harness.closed.browser).toBe(1)
    vi.useRealTimers()
  })

  it('does not close a browser that is still in the middle of a render', async () => {
    vi.useFakeTimers()
    const harness = fakeBrowser()
    const hb = createHeadlessBrowser({ launch: async () => harness.browser, idleMs: 5_000 })
    let release: () => void = () => {}
    const inFlight = hb.withPage({}, async () => new Promise<string>((r) => { release = () => r('done') }))
    await vi.advanceTimersByTimeAsync(20_000)
    expect(harness.closed.browser).toBe(0)
    release()
    await inFlight
    await hb.close()
    vi.useRealTimers()
  })

  it('is safe to close twice', async () => {
    const harness = fakeBrowser()
    const hb = createHeadlessBrowser({ launch: async () => harness.browser })
    await hb.withPage({}, async () => 'ok')
    await hb.close()
    await hb.close()
    expect(harness.closed.browser).toBe(1)
  })
})

describe('createHeadlessBrowser — probing the public web', () => {
  it('lets a real site load its own assets but not the host network', async () => {
    const harness = fakeBrowser()
    const hb = createHeadlessBrowser({ launch: async () => harness.browser })
    await hb.withPage({ allowPublicHttp: true }, async () => 'ok')
    const handler = harness.routes[0]
    expect(callRoute(handler, 'https://example.com/style.css').continued).toBe(true)
    expect(callRoute(handler, 'https://cdn.example.net/font.woff2').continued).toBe(true)
    // A probed page can link whatever it likes; these are the links that matter.
    expect(callRoute(handler, 'http://169.254.169.254/latest/meta-data/').aborted).toBe(true)
    expect(callRoute(handler, 'http://127.0.0.1:3100/api/v1/brands').aborted).toBe(true)
    expect(callRoute(handler, 'http://10.1.2.3/internal').aborted).toBe(true)
    expect(callRoute(handler, 'ftp://example.com/x').aborted).toBe(true)
    await hb.close()
  })
})
