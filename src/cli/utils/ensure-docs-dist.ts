// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { detectInstallRoot, resolveDocsDistDir } from '../../core/instance.js'
import { newestMtimeMs } from './ensure-web-dist.js'

export interface EnsureDocsDistOptions {
  /** Install root (repo / image WORKDIR). Default: detectInstallRoot(). */
  installRoot?: string
  /** When true, only check — never run install/build. */
  skipBuild?: boolean
  /** Print progress to stdout/stderr (CLI). Default true. */
  verbose?: boolean
  /** Rebuild if docs sources are newer than dist (default true). */
  rebuildIfStale?: boolean
}

export interface EnsureDocsDistResult {
  /** Absolute path to packages/docs/dist, or null. */
  docsDistDir: string | null
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

function docsPackageRoot(installRoot: string): string {
  return join(installRoot, 'packages', 'docs')
}

/**
 * True when docs sources are newer than dist/index.html (or dist missing).
 */
export function isDocsDistStale(installRoot: string, distDir: string): boolean {
  const indexHtml = join(distDir, 'index.html')
  if (!existsSync(indexHtml)) return true
  let distMtime = 0
  try {
    distMtime = statSync(indexHtml).mtimeMs
  } catch {
    return true
  }
  const srcRoot = join(docsPackageRoot(installRoot), 'src')
  const configFiles = [
    join(docsPackageRoot(installRoot), 'astro.config.mjs'),
    join(docsPackageRoot(installRoot), 'package.json'),
  ]
  let newest = existsSync(srcRoot) ? newestMtimeMs(srcRoot) : 0
  // Also watch markdown-only content (newestMtimeMs filters non-code; re-scan .md)
  newest = Math.max(newest, newestMarkdownMtimeMs(srcRoot))
  for (const f of configFiles) {
    if (!existsSync(f)) continue
    try {
      newest = Math.max(newest, statSync(f).mtimeMs)
    } catch {
      /* ignore */
    }
  }
  return newest > distMtime + 500
}

/** Like newestMtimeMs but for .md / .mdx content files. */
function newestMarkdownMtimeMs(dir: string, maxFiles = 5000): number {
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
      if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '.git' || ent.name === '.astro') {
        continue
      }
      const full = join(current, ent.name)
      if (ent.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!ent.isFile()) continue
      if (!/\.(md|mdx)$/i.test(ent.name)) continue
      seen++
      try {
        const mt = statSync(full).mtimeMs
        if (mt > newest) newest = mt
      } catch {
        /* ignore */
      }
    }
  }
  return newest
}

async function run(
  cmd: string[],
  cwd: string,
  verbose: boolean,
): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: verbose ? 'inherit' : 'pipe',
    stderr: verbose ? 'inherit' : 'pipe',
    env: process.env,
  })
  return proc.exited
}

/**
 * Ensure the Starlight docs static site exists under packages/docs/dist.
 *
 * Safe to call repeatedly. Does not block server start on failure — docs are
 * optional if the package or its deps are missing (e.g. slim Docker images
 * that intentionally omit them).
 *
 * Env:
 * - EYAS_SKIP_DOCS_BUILD=1 — never install/build
 * - EYAS_FORCE_DOCS_BUILD=1 — always rebuild
 */
export async function ensureDocsDist(
  options: EnsureDocsDistOptions = {},
): Promise<EnsureDocsDistResult> {
  const installRoot = options.installRoot ?? detectInstallRoot()
  const verbose = options.verbose !== false
  const skipBuild = options.skipBuild === true
    || process.env.EYAS_SKIP_DOCS_BUILD === '1'
    || process.env.EYAS_SKIP_DOCS_BUILD === 'true'
  const rebuildIfStale = options.rebuildIfStale !== false
    && process.env.EYAS_FORCE_DOCS_BUILD !== '0'

  const pkgDir = docsPackageRoot(installRoot)
  const pkgJson = join(pkgDir, 'package.json')
  if (!existsSync(pkgJson)) {
    return {
      docsDistDir: null,
      built: false,
      message: `No product docs package at ${pkgDir} — /docs will not be served`,
    }
  }

  const existing = resolveDocsDistDir(installRoot)
  let needsBuild = !existing
  let reason = 'missing'

  if (existing && rebuildIfStale && isDocsDistStale(installRoot, existing)) {
    needsBuild = true
    reason = 'stale'
  }

  if (process.env.EYAS_FORCE_DOCS_BUILD === '1' || process.env.EYAS_FORCE_DOCS_BUILD === 'true') {
    needsBuild = true
    reason = 'forced'
  }

  if (!needsBuild && existing) {
    return {
      docsDistDir: existing,
      built: false,
      message: `Docs build up to date at ${existing}`,
    }
  }

  if (skipBuild) {
    return {
      docsDistDir: existing,
      built: false,
      message: existing
        ? `Docs present but may be ${reason}; auto-build skipped (EYAS_SKIP_DOCS_BUILD)`
        : 'No docs build found and auto-build skipped (EYAS_SKIP_DOCS_BUILD)',
    }
  }

  // Ensure docs node_modules (separate package, not a workspace)
  const docsNm = join(pkgDir, 'node_modules', 'astro')
  if (!existsSync(docsNm)) {
    log(verbose, `[eyas] Docs deps missing — running: bun install (in packages/docs)`)
    const installCode = await run(
      [process.execPath, 'install'],
      pkgDir,
      verbose,
    )
    if (installCode !== 0) {
      logErr(verbose, `[eyas] bun install in packages/docs failed (exit ${installCode})`)
      return {
        docsDistDir: existing,
        built: false,
        message: `Docs dependency install failed with exit code ${installCode}`,
      }
    }
  }

  if (reason === 'stale') {
    log(verbose, `[eyas] Docs build is outdated — rebuilding…`)
  } else if (reason === 'forced') {
    log(verbose, `[eyas] Forced docs rebuild (EYAS_FORCE_DOCS_BUILD)…`)
  } else {
    log(verbose, `[eyas] Docs not built — running: bun run docs:build`)
  }
  log(verbose, `[eyas] cwd=${installRoot}`)

  const code = await run(
    [process.execPath, 'run', 'docs:build'],
    installRoot,
    verbose,
  )

  if (code !== 0) {
    logErr(verbose, `[eyas] bun run docs:build failed (exit ${code})`)
    logErr(verbose, `[eyas] Fix: cd packages/docs && bun install && bun run build`)
    return {
      docsDistDir: existing,
      built: true,
      message: `Docs build failed with exit code ${code}`,
    }
  }

  const built = resolveDocsDistDir(installRoot)
  if (!built) {
    logErr(verbose, '[eyas] docs:build finished but packages/docs/dist/index.html still missing')
    return {
      docsDistDir: existing,
      built: true,
      message: 'docs:build completed but docs dist not found',
    }
  }

  log(verbose, `[eyas] Docs ready: ${built}`)
  return {
    docsDistDir: built,
    built: true,
    message: `Docs built at ${built}`,
  }
}
