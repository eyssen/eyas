// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, mkdirSync, readFileSync } from 'fs'
import { isAbsolute, join, resolve } from 'path'

/**
 * Instance layout for multi-instance / multi-env deployments on one machine.
 *
 * - `installRoot` — code + shipped defaults (where the package lives)
 * - `home`        — per-instance state (data, local config, pid, logs)
 *
 * Resolution order for home:
 *   EYAS_HOME env → process.cwd()
 *
 * Resolution order for config (first hit wins as primary):
 *   --config / EYAS_CONFIG → $home/config.yaml → $home/config/default.yaml
 *   → $home/config/local.yaml (as primary if nothing else) → $installRoot/config/default.yaml
 *
 * local.yaml next to the primary (or at $home/config/local.yaml) is always
 * merged on top when present.
 */

export interface InstancePaths {
  installRoot: string
  home: string
  /** Primary YAML path (may not exist — loader falls back to defaults). */
  configPath: string
  /** Overlay merged after primary, if the file exists. */
  localConfigPath: string | null
  dataDir: string
  pidFile: string
  logFile: string
  databasePath: string
}

export interface ResolveInstanceOptions {
  /** Explicit config path from CLI (`--config`). */
  configPath?: string
  /** When true, create data/config dirs under home. Default true. */
  ensureDirs?: boolean
}

/** Detect the EYAS install root (source tree or image WORKDIR). */
export function detectInstallRoot(): string {
  if (process.env.EYAS_INSTALL_ROOT) {
    return resolve(process.env.EYAS_INSTALL_ROOT)
  }

  const argv1 = process.argv[1] ? resolve(process.argv[1]) : ''
  if (argv1) {
    // ./bin/eyas → repo root
    if (argv1.endsWith(`${join('bin', 'eyas')}`) || /\/bin\/eyas$/.test(argv1)) {
      return resolve(argv1, '..', '..')
    }
    // dist/main.js or dist/cli → parent of dist
    if (argv1.includes(`${join('dist', '')}`) || /\/dist\//.test(argv1)) {
      const distIdx = argv1.lastIndexOf(`${join('dist')}`)
      if (distIdx >= 0) return resolve(argv1.slice(0, distIdx))
    }
  }

  // Walk up from cwd looking for package.json name "eyas"
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      try {
        const raw = JSON.parse(readFileSync(pkg, 'utf-8')) as { name?: string }
        if (raw.name === 'eyas') return dir
      } catch {
        // ignore
      }
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }

  return process.cwd()
}

export function resolveHome(): string {
  if (process.env.EYAS_HOME) return resolve(process.env.EYAS_HOME)
  return process.cwd()
}

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

/**
 * Resolve all instance paths. Pure path logic except optional mkdir.
 */
export function resolveInstance(options: ResolveInstanceOptions = {}): InstancePaths {
  const installRoot = detectInstallRoot()
  const home = resolveHome()
  const ensureDirs = options.ensureDirs !== false

  const dataDir = process.env.EYAS_DATA_DIR
    ? resolve(process.env.EYAS_DATA_DIR)
    : join(home, 'data')

  const pidFile = process.env.EYAS_PID_FILE
    ? resolve(process.env.EYAS_PID_FILE)
    : join(dataDir, 'eyas.pid')

  const logFile = process.env.EYAS_LOG_FILE
    ? resolve(process.env.EYAS_LOG_FILE)
    : join(dataDir, 'eyas.log')

  // Explicit config wins
  let configPath: string
  if (options.configPath && options.configPath.length > 0) {
    configPath = isAbsolute(options.configPath)
      ? options.configPath
      : resolve(process.cwd(), options.configPath)
  } else if (process.env.EYAS_CONFIG) {
    configPath = resolve(process.env.EYAS_CONFIG)
  } else {
    const found = firstExisting([
      join(home, 'config.yaml'),
      join(home, 'config', 'default.yaml'),
      join(installRoot, 'config', 'default.yaml'),
      resolve(process.cwd(), 'config', 'default.yaml'),
    ])
    configPath = found ?? join(installRoot, 'config', 'default.yaml')
  }

  // local.yaml overlay. Prefer $home/config/local.yaml when EYAS_HOME is set
  // (multi-instance), otherwise sibling of the primary config file.
  const siblingLocal = resolve(join(configPath, '..', 'local.yaml'))
  const homeLocal = join(home, 'config', 'local.yaml')
  let localConfigPath: string | null = null
  if (process.env.EYAS_HOME && existsSync(homeLocal) && homeLocal !== resolve(configPath)) {
    localConfigPath = homeLocal
  } else if (existsSync(siblingLocal) && siblingLocal !== resolve(configPath)) {
    localConfigPath = siblingLocal
  } else if (existsSync(homeLocal) && homeLocal !== resolve(configPath)) {
    localConfigPath = homeLocal
  }

  // Default DB path under the instance data dir
  const databasePath = join(dataDir, 'sqlite', 'eyas.db')

  if (ensureDirs) {
    mkdirSync(join(dataDir, 'sqlite'), { recursive: true })
    mkdirSync(join(home, 'config'), { recursive: true })
  }

  return {
    installRoot,
    home,
    configPath,
    localConfigPath,
    dataDir,
    pidFile,
    logFile,
    databasePath,
  }
}

/**
 * Resolve static frontend build directory (install tree or Docker layout).
 * When `installRoot` is passed explicitly, only that tree is searched
 * (no process.cwd() fallback — keeps EYAS_HOME / tests deterministic).
 */
export function resolveWebDistDir(installRoot?: string): string | null {
  const explicit = installRoot !== undefined && installRoot !== null
  const root = explicit ? installRoot : detectInstallRoot()
  const candidates = [
    join(root, 'src', 'web', 'dist'),
    join(root, 'dist', 'web'),
  ]
  if (!explicit) {
    candidates.push(
      join(process.cwd(), 'src', 'web', 'dist'),
      join(process.cwd(), 'dist', 'web'),
    )
  }
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir
  }
  return null
}

/**
 * Resolve Starlight docs static build (`packages/docs/dist`).
 * Docker may also place it at `dist/docs`.
 */
export function resolveDocsDistDir(installRoot?: string): string | null {
  const explicit = installRoot !== undefined && installRoot !== null
  const root = explicit ? installRoot : detectInstallRoot()
  const candidates = [
    join(root, 'packages', 'docs', 'dist'),
    join(root, 'dist', 'docs'),
  ]
  if (!explicit) {
    candidates.push(
      join(process.cwd(), 'packages', 'docs', 'dist'),
      join(process.cwd(), 'dist', 'docs'),
    )
  }
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir
  }
  return null
}
