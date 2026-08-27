// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/shared/playwright-loader.ts
//
// One place that knows how to obtain a Chromium.
//
// `playwright-core` is a real dependency: Apache-2.0, no postinstall, no
// runtime dependencies of its own. What stays optional is the BROWSER BINARY,
// which is ~150 MB and cannot be shipped in an npm package. Everything here
// exists to answer "is there a browser, and where" without ever making that
// question fatal — a self-hosted EYAS with no browser must still boot, and the
// features that need one must say so instead of crashing.
//
// The full `playwright` package is deliberately NOT the dependency. Its
// postinstall downloads three browsers (~500 MB), and Bun skips postinstall
// scripts for untrusted dependencies — so it would install the package, skip
// the download, and then fail at launch. `playwright-core` makes that failure
// mode impossible by never pretending the browser is bundled.

import { existsSync } from 'node:fs'

const REMEDIATION = [
  'Install a browser for Playwright with `bunx playwright-core install chromium`,',
  'or point EYAS_CHROMIUM_PATH at an existing Chromium or Chrome executable.',
].join(' ')

const SANDBOX_REMEDIATION = [
  "Chromium could not start its own sandbox, which usually means the container",
  'forbids unprivileged user namespaces. Allow them, or accept the trade-off and',
  'set EYAS_CHROMIUM_NO_SANDBOX=1 — the renderer then runs unsandboxed, and it is',
  'the renderer that executes AI-authored artboard JavaScript.',
].join(' ')

/** A launch failure that is about the sandbox, not about a missing binary. */
export function isSandboxFailure(message: string): boolean {
  return /sandbox|namespace|SUID|clone\(\)/i.test(message)
}

/**
 * Flags every launch gets.
 *
 * `--disable-dev-shm-usage` is not a security setting: containers default to a
 * 64 MB /dev/shm and Chromium crashes rendering anything substantial into it.
 *
 * `--no-sandbox` is NOT here, and is not added automatically on a sandbox
 * failure either. Retrying unsandboxed would silently turn a deployment
 * problem into a security downgrade, in the one process that runs
 * model-authored JavaScript. It takes an explicit environment variable.
 */
export function launchArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const args = ['--disable-dev-shm-usage']
  if ((env.EYAS_CHROMIUM_NO_SANDBOX ?? '').trim() === '1') {
    args.push('--no-sandbox', '--disable-setuid-sandbox')
  }
  return args
}

export class BrowserUnavailableError extends Error {
  readonly remediation: string
  constructor(message: string, remediation: string = REMEDIATION) {
    super(message)
    this.name = 'BrowserUnavailableError'
    this.remediation = remediation
  }
}

export interface PlaywrightLike {
  chromium: { launch(options?: Record<string, unknown>): Promise<any> }
}

export interface ResolveDeps {
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
  platform?: NodeJS.Platform
}

/**
 * The operator's explicit choice. A configured path that is not on disk is an
 * error rather than a hint: someone who names a binary means that binary, and
 * quietly printing from a different browser is worse than not printing.
 */
export function resolveConfiguredChromium(deps: ResolveDeps = {}): string | undefined {
  const env = deps.env ?? process.env
  const exists = deps.exists ?? existsSync
  const configured = (env.EYAS_CHROMIUM_PATH ?? '').trim()
  if (!configured) return undefined
  if (!exists(configured)) {
    throw new BrowserUnavailableError(
      `EYAS_CHROMIUM_PATH points at ${configured}, which does not exist`,
      'Correct EYAS_CHROMIUM_PATH, or unset it to fall back to the browser Playwright manages.',
    )
  }
  return configured
}

/** Where a system browser usually lives, in the order we would rather have it. */
export function knownChromiumPaths(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'darwin') {
    return [
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]
  }
  if (platform === 'win32') {
    return [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
  }
  return [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
  ]
}

export function firstExistingChromium(deps: ResolveDeps = {}): string | undefined {
  const exists = deps.exists ?? existsSync
  return knownChromiumPaths(deps.platform ?? process.platform).find((p) => exists(p))
}

/**
 * Import playwright-core. Wrapped because a module resolution failure reaches
 * the user as an HTTP error, and "Cannot find module" is not something they can
 * act on.
 */
export async function loadPlaywright(load?: () => Promise<any>): Promise<PlaywrightLike> {
  let mod: any
  try {
    mod = load ? await load() : await import('playwright-core')
  } catch (err) {
    throw new BrowserUnavailableError(
      `playwright-core could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
      'Reinstall dependencies with `bun install`. playwright-core is a declared dependency and should always be present.',
    )
  }
  const chromium = mod?.chromium ?? mod?.default?.chromium
  if (!chromium || typeof chromium.launch !== 'function') {
    throw new BrowserUnavailableError('playwright-core loaded but exposes no chromium launcher')
  }
  return { chromium }
}

export interface LaunchDeps extends ResolveDeps {
  load?: () => Promise<any>
  /** Extra launch arguments. `--no-sandbox` belongs here, never as a default. */
  args?: string[]
  /** Headed mode is for a human debugging a browser tool, never for rendering. */
  headless?: boolean
}

/**
 * Launch Chromium, preferring the browser Playwright manages.
 *
 * The order matters. Playwright's own browser is version-matched to this
 * client, so its remote-debugging protocol is guaranteed to line up; an
 * arbitrary system Chrome may be years newer or older. A system browser is
 * therefore the fallback, not the default — but it is a real fallback, because
 * a container that already has chromium from apt should not need a second copy.
 */
export async function launchChromium(deps: LaunchDeps = {}): Promise<any> {
  const pw = await loadPlaywright(deps.load)
  const env = deps.env ?? process.env
  const base: Record<string, unknown> = {
    headless: deps.headless ?? true,
    args: [...launchArgs(env), ...(deps.args ?? [])],
  }

  const configured = resolveConfiguredChromium(deps)
  if (configured) {
    try {
      return await pw.chromium.launch({ ...base, executablePath: configured })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BrowserUnavailableError(
        `the browser at ${configured} could not be launched: ${message}`,
        isSandboxFailure(message)
          ? SANDBOX_REMEDIATION
          : 'Check that EYAS_CHROMIUM_PATH is an executable Chromium or Chrome build.',
      )
    }
  }

  let registryError: unknown
  try {
    return await pw.chromium.launch(base)
  } catch (err) {
    registryError = err
  }

  const system = firstExistingChromium(deps)
  if (system) {
    try {
      return await pw.chromium.launch({ ...base, executablePath: system })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BrowserUnavailableError(
        `no usable browser: Playwright's own build failed to launch and ${system} did not work either (${message})`,
        isSandboxFailure(message) ? SANDBOX_REMEDIATION : REMEDIATION,
      )
    }
  }

  const message = registryError instanceof Error ? registryError.message : String(registryError)
  throw new BrowserUnavailableError(
    `no browser is available: ${message}`,
    isSandboxFailure(message) ? SANDBOX_REMEDIATION : REMEDIATION,
  )
}
