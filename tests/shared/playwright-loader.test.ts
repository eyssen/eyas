// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import {
  assertEyAsUserDataDir,
  BrowserUnavailableError,
  firstExistingChromium,
  isDailyBrowserProfile,
  knownChromiumPaths,
  launchChromium,
  launchPersistentChromium,
  loadPlaywright,
  resolveConfiguredChromium,
} from '@shared/playwright-loader'

describe('resolveConfiguredChromium', () => {
  it('returns nothing when the operator configured nothing', () => {
    expect(resolveConfiguredChromium({ env: {}, exists: () => true })).toBeUndefined()
  })

  it('returns the configured path when it exists', () => {
    const path = '/opt/chrome/chrome'
    expect(resolveConfiguredChromium({ env: { EYAS_CHROMIUM_PATH: path }, exists: (p) => p === path })).toBe(path)
  })

  it('refuses a configured path that is not there rather than quietly using another browser', () => {
    // An operator who names a binary means that binary. Falling through to a
    // different one would print output from a browser they did not choose.
    expect(() =>
      resolveConfiguredChromium({ env: { EYAS_CHROMIUM_PATH: '/nope/chrome' }, exists: () => false }),
    ).toThrow(BrowserUnavailableError)
  })

  it('ignores an empty or whitespace-only setting', () => {
    expect(resolveConfiguredChromium({ env: { EYAS_CHROMIUM_PATH: '   ' }, exists: () => false })).toBeUndefined()
  })
})

describe('knownChromiumPaths', () => {
  it('offers macOS application bundles on darwin', () => {
    const paths = knownChromiumPaths('darwin')
    expect(paths.some((p) => p.includes('.app/Contents/MacOS/'))).toBe(true)
  })

  it('offers the Debian binaries on linux, which is what the container has', () => {
    const paths = knownChromiumPaths('linux')
    expect(paths).toContain('/usr/bin/chromium')
    expect(paths).toContain('/usr/bin/chromium-browser')
  })

  it('never returns the same path twice', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as NodeJS.Platform[]) {
      const paths = knownChromiumPaths(platform)
      expect(new Set(paths).size).toBe(paths.length)
    }
  })
})

describe('firstExistingChromium', () => {
  it('takes the first path that is actually on disk, in preference order', () => {
    const paths = knownChromiumPaths('linux')
    const second = paths[1]
    expect(firstExistingChromium({ platform: 'linux', exists: (p) => p === second })).toBe(second)
  })

  it('returns nothing when none of them exist', () => {
    expect(firstExistingChromium({ platform: 'linux', exists: () => false })).toBeUndefined()
  })
})

describe('loadPlaywright', () => {
  it('returns the module when the import resolves', async () => {
    const fake = { chromium: { launch: vi.fn() } }
    await expect(loadPlaywright(async () => fake)).resolves.toMatchObject({ chromium: fake.chromium })
  })

  it('accepts a module behind a default export, which is how bundlers hand it over', async () => {
    const chromium = { launch: vi.fn() }
    await expect(loadPlaywright(async () => ({ default: { chromium } }))).resolves.toMatchObject({ chromium })
  })

  it('turns a missing module into an actionable error, not a raw import failure', async () => {
    const err = await loadPlaywright(async () => {
      throw new Error('Cannot find module')
    }).catch((e) => e)
    expect(err).toBeInstanceOf(BrowserUnavailableError)
    expect((err as BrowserUnavailableError).remediation).toContain('playwright-core')
  })

  it('rejects a module that does not expose chromium', async () => {
    await expect(loadPlaywright(async () => ({}) as any)).rejects.toBeInstanceOf(BrowserUnavailableError)
  })
})

describe('launchChromium', () => {
  const browser = { name: 'browser' }

  it('uses the configured executable and never probes anything else', async () => {
    const launch = vi.fn(async (_opts?: Record<string, any>) => browser)
    const result = await launchChromium({
      load: async () => ({ chromium: { launch } }),
      env: { EYAS_CHROMIUM_PATH: '/opt/chrome' },
      exists: (p) => p === '/opt/chrome',
      platform: 'linux',
    })
    expect(result).toBe(browser)
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch.mock.calls[0]![0]).toMatchObject({ executablePath: '/opt/chrome' })
  })

  it("prefers Playwright's own browser registry over a system install", async () => {
    // The registry browser is version-matched to playwright-core. An arbitrary
    // system Chrome may speak a protocol this client does not.
    const launch = vi.fn(async (_opts?: Record<string, any>) => browser)
    await launchChromium({
      load: async () => ({ chromium: { launch } }),
      env: {},
      exists: () => true,
      platform: 'linux',
    })
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch.mock.calls[0]![0]?.executablePath).toBeUndefined()
  })

  it('falls back to a system browser when the registry has none', async () => {
    const launch = vi
      .fn(async (_opts?: Record<string, any>) => browser)
      .mockRejectedValueOnce(new Error("Executable doesn't exist at /root/.cache/ms-playwright/chromium-1/chrome"))
      .mockResolvedValueOnce(browser)
    const result = await launchChromium({
      load: async () => ({ chromium: { launch } }),
      env: {},
      exists: (p) => p === '/usr/bin/chromium',
      platform: 'linux',
    })
    expect(result).toBe(browser)
    expect(launch).toHaveBeenCalledTimes(2)
    expect(launch.mock.calls[1]![0]).toMatchObject({ executablePath: '/usr/bin/chromium' })
  })

  it('reports both remedies when there is no browser anywhere', async () => {
    const launch = vi.fn(async (_opts?: Record<string, any>) => browser).mockRejectedValue(new Error("Executable doesn't exist"))
    const err = await launchChromium({
      load: async () => ({ chromium: { launch } }),
      env: {},
      exists: () => false,
      platform: 'linux',
    }).catch((e) => e)
    expect(err).toBeInstanceOf(BrowserUnavailableError)
    expect((err as BrowserUnavailableError).remediation).toContain('playwright-core install chromium')
    expect((err as BrowserUnavailableError).remediation).toContain('EYAS_CHROMIUM_PATH')
  })

  it('runs headless with no sandbox escape hatch left on by default', async () => {
    const launch = vi.fn(async (_opts?: Record<string, any>) => browser)
    await launchChromium({ load: async () => ({ chromium: { launch } }), env: {}, exists: () => false, platform: 'linux' })
    expect(launch.mock.calls[0]![0]).toMatchObject({ headless: true })
  })
})

describe('launch arguments', () => {
  it('always works around the container /dev/shm size', async () => {
    const browser = {}
    const launch = vi.fn(async (_opts?: Record<string, any>) => browser)
    await launchChromium({ load: async () => ({ chromium: { launch } }), env: {}, exists: () => false, platform: 'linux' })
    expect(launch.mock.calls[0]![0]?.args).toContain('--disable-dev-shm-usage')
  })

  it('never disables the sandbox on its own', async () => {
    // The renderer is what executes AI-authored artboard JavaScript. Turning
    // its sandbox off is an operator's decision, not a fallback.
    const browser = {}
    const launch = vi.fn(async (_opts?: Record<string, any>) => browser)
    await launchChromium({ load: async () => ({ chromium: { launch } }), env: {}, exists: () => false, platform: 'linux' })
    expect(launch.mock.calls[0]![0]?.args).not.toContain('--no-sandbox')
  })

  it('does not retry unsandboxed after a sandbox failure', async () => {
    const launch = vi.fn(async (_opts?: Record<string, any>) => {
      throw new Error('Failed to move to new namespace: clone() returned EPERM')
    })
    const err = await launchChromium({
      load: async () => ({ chromium: { launch } }), env: {}, exists: () => false, platform: 'linux',
    }).catch((e) => e)
    expect(launch).toHaveBeenCalledTimes(1)
    expect((err as BrowserUnavailableError).remediation).toContain('EYAS_CHROMIUM_NO_SANDBOX')
  })

  it('honours an explicit opt-out', async () => {
    const browser = {}
    const launch = vi.fn(async (_opts?: Record<string, any>) => browser)
    await launchChromium({
      load: async () => ({ chromium: { launch } }),
      env: { EYAS_CHROMIUM_NO_SANDBOX: '1' },
      exists: () => false,
      platform: 'linux',
    })
    expect(launch.mock.calls[0]![0]?.args).toContain('--no-sandbox')
  })
})

describe('daily browser profile', () => {
  it('rejects Chrome/Edge user-data dirs and allows an EYAS-owned profile', () => {
    expect(isDailyBrowserProfile('/Users/x/Library/Application Support/Google/Chrome')).toBe(true)
    expect(isDailyBrowserProfile('/Users/x/Library/Application Support/Google/Chrome/Default')).toBe(true)
    expect(isDailyBrowserProfile('C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\User Data')).toBe(true)
    expect(isDailyBrowserProfile('/home/x/.config/google-chrome')).toBe(true)
    expect(isDailyBrowserProfile('/home/x/.config/chromium')).toBe(true)
    expect(isDailyBrowserProfile('/var/lib/eyas/data/browser/profile')).toBe(false)
    expect(isDailyBrowserProfile('data/browser/profile')).toBe(false)
  })

  it('throws before launch when asked to use the daily profile', () => {
    expect(() => assertEyAsUserDataDir('/Users/x/Library/Application Support/Google/Chrome')).toThrow(
      /Chrome 136|daily browser profile/,
    )
  })
})

describe('launchPersistentChromium', () => {
  it('calls launchPersistentContext with the EYAS userDataDir, never a daily profile', async () => {
    const context = { name: 'persistent' }
    const launchPersistentContext = vi.fn(async (_dir: string, _opts?: Record<string, any>) => context)
    const result = await launchPersistentChromium('/tmp/eyas-browser-profile', {
      load: async () => ({ chromium: { launch: vi.fn(), launchPersistentContext } }),
      env: {},
      exists: () => false,
      platform: 'linux',
      extraContextOptions: { userAgent: 'EYAS/1.0 Browser Agent', acceptDownloads: true },
    })
    expect(result).toBe(context)
    expect(launchPersistentContext).toHaveBeenCalledTimes(1)
    expect(launchPersistentContext.mock.calls[0]![0]).toBe('/tmp/eyas-browser-profile')
    expect(launchPersistentContext.mock.calls[0]![1]).toMatchObject({
      headless: true,
      userAgent: 'EYAS/1.0 Browser Agent',
      acceptDownloads: true,
    })
    expect(launchPersistentContext.mock.calls[0]![1]?.args).not.toContain('--no-sandbox')
  })

  it('refuses the operator Chrome profile before calling Playwright', async () => {
    const launchPersistentContext = vi.fn()
    await expect(
      launchPersistentChromium('/Users/x/Library/Application Support/Google/Chrome', {
        load: async () => ({ chromium: { launch: vi.fn(), launchPersistentContext } }),
      }),
    ).rejects.toThrow(/daily browser profile/)
    expect(launchPersistentContext).not.toHaveBeenCalled()
  })
})
