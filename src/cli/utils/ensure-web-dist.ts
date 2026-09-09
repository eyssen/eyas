// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { detectInstallRoot, resolveWebDistDir } from '../../core/instance.js'
import {
  installNestedPackage,
  isWebFrontendReady,
} from '../../../scripts/install-nested-package'

export interface EnsureWebDistOptions {
  /** Install root (repo / image WORKDIR). Default: detectInstallRoot(). */
  installRoot?: string
  /**
   * When true, only check — never run the build (e.g. Docker image where the
   * frontend was baked in at build time, or --no-build).
   */
  skipBuild?: boolean
  /** Print progress to stdout/stderr (CLI). Default true. */
  verbose?: boolean
  /**
   * When true (default), rebuild if any file under src/web/src is newer than
   * the dist index.html. Prevents serving a weeks-old UI after code changes.
   */
  rebuildIfStale?: boolean
}

export interface EnsureWebDistResult {
  /** Absolute path to the dist dir, or null if still missing after attempt. */
  webDistDir: string | null
  /** Whether a build was executed in this call. */
  built: boolean
  /** Human-readable status for logs. */
  message: string
}

function log(verbose: boolean, msg: string): void {
  if (verbose) console.log(msg)
}

function logErr(verbose: boolean, msg: string): void {
  if (verbose) console.error(msg)
}

/** Recursively find the newest mtime (ms) under `dir`, or 0 if empty/missing. */
export function newestMtimeMs(dir: string, maxFiles = 5000): number {
  if (!existsSync(dir)) return 0
  let newest = 0
  let seen = 0
  const stack = [dir]
  while (stack.length > 0 && seen < maxFiles) {
    const current = stack.pop()!
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '.git') continue
      const full = join(current, ent.name)
      if (ent.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!ent.isFile()) continue
      // Only TS/TSX/CSS/JSON that affect the Vite build
      if (!/\.(tsx?|jsx?|css|json|svg)$/.test(ent.name)) continue
      seen++
      try {
        const mt = statSync(full).mtimeMs
        if (mt > newest) newest = mt
      } catch {
        // ignore
      }
    }
  }
  return newest
}

/**
 * True when source under src/web/src is newer than dist/index.html
 * (or dist is missing its index).
 */
export function isWebDistStale(installRoot: string, distDir: string): boolean {
  const indexHtml = join(distDir, 'index.html')
  if (!existsSync(indexHtml)) return true
  let distMtime = 0
  try {
    distMtime = statSync(indexHtml).mtimeMs
  } catch {
    return true
  }
  const srcRoot = join(installRoot, 'src', 'web', 'src')
  if (!existsSync(srcRoot)) return false
  const srcNewest = newestMtimeMs(srcRoot)
  return srcNewest > distMtime + 500 // 0.5s skew tolerance
}

/**
 * Ensure a production frontend build exists and is not older than sources.
 *
 * Looks for `src/web/dist/index.html` or `dist/web/index.html`. If missing or
 * stale (sources newer than dist), runs `bun run build:web` in the install root.
 *
 * Safe to call repeatedly — no-ops when dist is present and up to date.
 */
export async function ensureWebDist(
  options: EnsureWebDistOptions = {},
): Promise<EnsureWebDistResult> {
  const installRoot = options.installRoot ?? detectInstallRoot()
  const verbose = options.verbose !== false
  const skipBuild = options.skipBuild === true
    || process.env.EYAS_SKIP_WEB_BUILD === '1'
    || process.env.EYAS_SKIP_WEB_BUILD === 'true'
  const rebuildIfStale = options.rebuildIfStale !== false
    && process.env.EYAS_FORCE_WEB_BUILD !== '0'

  const existing = resolveWebDistDir(installRoot)
  let needsBuild = !existing
  let reason = 'missing'

  if (existing && rebuildIfStale && isWebDistStale(installRoot, existing)) {
    needsBuild = true
    reason = 'stale'
  }

  // Allow forcing a rebuild: EYAS_FORCE_WEB_BUILD=1
  if (process.env.EYAS_FORCE_WEB_BUILD === '1' || process.env.EYAS_FORCE_WEB_BUILD === 'true') {
    needsBuild = true
    reason = 'forced'
  }

  if (!needsBuild && existing) {
    return {
      webDistDir: existing,
      built: false,
      message: `Frontend build up to date at ${existing}`,
    }
  }

  if (skipBuild) {
    return {
      webDistDir: existing,
      built: false,
      message: existing
        ? `Frontend present but may be ${reason}; auto-build skipped (EYAS_SKIP_WEB_BUILD)`
        : 'No frontend build found and auto-build skipped (EYAS_SKIP_WEB_BUILD)',
    }
  }

  const pkg = join(installRoot, 'package.json')
  if (!existsSync(pkg)) {
    return {
      webDistDir: existing,
      built: false,
      message: `No package.json at ${installRoot} — cannot auto-build frontend`,
    }
  }

  // src/web is its own package (not a workspace). Root bun install does not
  // put Vite or @vitejs/plugin-react on disk — that is what the one-line
  // installer used to hit as "Cannot find package '@vitejs/plugin-react'".
  const webDir = join(installRoot, 'src', 'web')
  if (existsSync(join(webDir, 'package.json')) && !isWebFrontendReady(installRoot)) {
    log(verbose, `[eyas] Frontend deps missing — running: bun install (in src/web)`)
    const nested = await installNestedPackage(webDir, {
      skipIfReady: ['vite', '@vitejs/plugin-react'],
    })
    if (!nested.ok) {
      logErr(verbose, `[eyas] ${nested.message}`)
      logErr(verbose, `[eyas] Fix: cd ${webDir} && bun install && cd ${installRoot} && bun run build:web`)
      return {
        webDistDir: existing,
        built: false,
        message: nested.message,
      }
    }
    if (nested.skippedLinks.length > 0) {
      log(verbose, `[eyas] ${nested.message}`)
    }
  }

  if (reason === 'stale') {
    log(verbose, `[eyas] Frontend build is outdated (source newer than dist) — rebuilding…`)
  } else if (reason === 'forced') {
    log(verbose, `[eyas] Forced frontend rebuild (EYAS_FORCE_WEB_BUILD)…`)
  } else {
    log(verbose, `[eyas] Frontend not built — running: bun run build:web`)
  }
  log(verbose, `[eyas] cwd=${installRoot} (first build may take a minute)`)

  const runBuild = async (): Promise<number> => {
    const proc = Bun.spawn([process.execPath, 'run', 'build:web'], {
      cwd: installRoot,
      stdout: verbose ? 'inherit' : 'pipe',
      stderr: verbose ? 'inherit' : 'pipe',
      env: process.env,
    })
    return proc.exited
  }

  let code = await runBuild()
  if (code !== 0 && !isWebFrontendReady(installRoot)) {
    log(verbose, `[eyas] build:web failed — installing src/web deps and retrying`)
    const nested = await installNestedPackage(webDir)
    if (nested.ok) {
      if (nested.skippedLinks.length > 0) log(verbose, `[eyas] ${nested.message}`)
      code = await runBuild()
    }
  }
  if (code !== 0) {
    logErr(verbose, `[eyas] bun run build:web failed (exit ${code})`)
    logErr(verbose, `[eyas] Fix: cd ${webDir} && bun install && cd ${installRoot} && bun run build:web`)
    // Fall back to existing stale dist if any (better than no UI)
    return {
      webDistDir: existing,
      built: true,
      message: `Frontend build failed with exit code ${code}`,
    }
  }

  const built = resolveWebDistDir(installRoot)
  if (!built) {
    logErr(verbose, '[eyas] build:web finished but src/web/dist/index.html still missing')
    return {
      webDistDir: existing,
      built: true,
      message: 'build:web completed but frontend dist not found',
    }
  }

  log(verbose, `[eyas] Frontend ready: ${built}`)
  return {
    webDistDir: built,
    built: true,
    message: `Frontend built at ${built}`,
  }
}
