#!/usr/bin/env bun
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// bun install in a nested package that is NOT a workspace (src/web, packages/docs).
// Root `bun install` does not install those trees.
//
// If the package.json lists `link:` deps that are not `bun link`-ed on this
// machine (e.g. @saker/* — a sibling editor, not shipped with a public clone),
// they are skipped and the rest is installed so the build can still proceed.
//
// Usage: bun scripts/install-nested-package.ts <dir>
// Exit 0 on success (including "nothing to install"), 1 on failure.

import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const LINK_DEP_KEYS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const

export type JsonMap = Record<string, unknown>

export interface NestedInstallResult {
  ok: boolean
  skippedLinks: string[]
  message: string
}

export function isUnresolvedPackageError(text: string): boolean {
  return /Cannot find (?:package|module) /i.test(text)
    || /failed to resolve/i.test(text)
    || /is not linked/i.test(text)
}

export function isUnlinkedPackageError(text: string): boolean {
  return /is not linked/i.test(text)
    || /link:.*failed to resolve/i.test(text)
}

export function listLinkDependencies(pkg: JsonMap): string[] {
  const names: string[] = []
  for (const key of LINK_DEP_KEYS) {
    const bag = pkg[key]
    if (!bag || typeof bag !== 'object') continue
    for (const [name, spec] of Object.entries(bag as Record<string, unknown>)) {
      if (String(spec).startsWith('link:')) names.push(name)
    }
  }
  return names
}

export function stripLinkDependencies(pkg: JsonMap): { pkg: JsonMap; stripped: string[] } {
  const next = structuredClone(pkg) as JsonMap
  const stripped: string[] = []
  for (const key of LINK_DEP_KEYS) {
    const bag = next[key]
    if (!bag || typeof bag !== 'object') continue
    const rec = bag as Record<string, unknown>
    for (const [name, spec] of Object.entries(rec)) {
      if (String(spec).startsWith('link:')) {
        delete rec[name]
        stripped.push(name)
      }
    }
  }
  return { pkg: next, stripped }
}

/** True when each marker package has a package.json under dir/node_modules. */
export function nestedPackageReady(dir: string, markers: string[]): boolean {
  if (!existsSync(join(dir, 'package.json'))) return false
  if (markers.length === 0) return existsSync(join(dir, 'node_modules'))
  return markers.every((pkg) => {
    const parts = pkg.split('/')
    return existsSync(join(dir, 'node_modules', ...parts, 'package.json'))
  })
}

export const WEB_READY_MARKERS = ['vite', '@vitejs/plugin-react'] as const

export function isWebFrontendReady(installRoot: string): boolean {
  return nestedPackageReady(join(installRoot, 'src', 'web'), [...WEB_READY_MARKERS])
}

async function bunInstall(
  dir: string,
  frozen: boolean,
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const args = ['install']
  if (frozen) args.push('--frozen-lockfile')
  const proc = Bun.spawn([process.execPath, ...args], {
    cwd: dir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: env ?? process.env,
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  return { code, stdout, stderr }
}

function restoreFile(path: string, original: string | null): void {
  if (original === null) {
    if (existsSync(path)) {
      try { unlinkSync(path) } catch { /* ignore */ }
    }
    return
  }
  writeFileSync(path, original)
}

export async function installNestedPackage(
  dir: string,
  opts: { frozen?: boolean; env?: Record<string, string>; skipIfReady?: string[] } = {},
): Promise<NestedInstallResult> {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) {
    return { ok: true, skippedLinks: [], message: `No package.json in ${dir}` }
  }

  if (opts.skipIfReady && nestedPackageReady(dir, opts.skipIfReady)) {
    return { ok: true, skippedLinks: [], message: `Already installed in ${dir}` }
  }

  const lockPath = join(dir, 'bun.lock')
  const tryFrozen = opts.frozen ?? existsSync(lockPath)
  const env = opts.env

  let result = await bunInstall(dir, tryFrozen, env)
  if (result.code === 0) {
    return { ok: true, skippedLinks: [], message: `Installed ${dir}` }
  }

  const firstLog = `${result.stdout}\n${result.stderr}`
  if (tryFrozen) {
    result = await bunInstall(dir, false, env)
    if (result.code === 0) {
      return { ok: true, skippedLinks: [], message: `Installed ${dir} (unlocked)` }
    }
  }

  const combined = `${firstLog}\n${result.stdout}\n${result.stderr}`
  if (!isUnlinkedPackageError(combined) && !isUnresolvedPackageError(combined)) {
    return {
      ok: false,
      skippedLinks: [],
      message: `bun install failed in ${dir}: ${(result.stderr || result.stdout).slice(0, 500)}`,
    }
  }

  const origPkg = readFileSync(pkgPath, 'utf8')
  const origLock = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null
  let parsed: JsonMap
  try {
    parsed = JSON.parse(origPkg) as JsonMap
  } catch (err) {
    return { ok: false, skippedLinks: [], message: `Invalid package.json in ${dir}: ${err}` }
  }

  const { pkg, stripped } = stripLinkDependencies(parsed)
  if (stripped.length === 0) {
    return {
      ok: false,
      skippedLinks: [],
      message: `bun install failed in ${dir}: ${(result.stderr || result.stdout).slice(0, 500)}`,
    }
  }

  const bak = `${pkgPath}.eyas-installer.bak`
  copyFileSync(pkgPath, bak)
  try {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    result = await bunInstall(dir, false, env)
    if (result.code !== 0) {
      return {
        ok: false,
        skippedLinks: stripped,
        message: `bun install failed in ${dir} after skipping ${stripped.join(', ')}: ${(result.stderr || result.stdout).slice(0, 500)}`,
      }
    }
    return {
      ok: true,
      skippedLinks: stripped,
      message: `Installed ${dir}, skipped unlinked packages: ${stripped.join(', ')}`,
    }
  } finally {
    restoreFile(pkgPath, origPkg)
    restoreFile(lockPath, origLock)
    try { unlinkSync(bak) } catch { /* ignore */ }
  }
}

async function main(argv: string[]): Promise<number> {
  const dirArg = argv[0]
  if (!dirArg || dirArg === '--help' || dirArg === '-h') {
    console.log('Usage: bun scripts/install-nested-package.ts <dir>')
    return dirArg ? 0 : 1
  }
  const dir = resolve(dirArg)
  const result = await installNestedPackage(dir)
  if (result.skippedLinks.length > 0) {
    console.warn(`[WARN] ${result.message}`)
  } else {
    console.log(`[OK] ${result.message}`)
  }
  if (!result.ok) {
    console.error(`[ERROR] ${result.message}`)
    return 1
  }
  return 0
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
