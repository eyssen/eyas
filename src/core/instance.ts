// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, resolve } from 'path'

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
  /**
   * Root of the folders EYAS creates for models to work in: one per
   * conversation without Folders, plus `_runs/<runId>` scratch for runs
   * without one. Never inside a git work tree unless EYAS_WORKSPACES_DIR
   * says so — see resolveWorkspacesDir.
   */
  workspacesDir: string
  /** EYAS-owned homes of the CLI providers (`<dataDir>/cli-homes/<provider>`). */
  cliHomesDir: string
  /**
   * The memory vault (`<dataDir>/vault`): EYAS's semantic/procedural markdown
   * notes. The only place the vault lives, so it follows EYAS_DATA_DIR.
   */
  vaultDir: string
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

  const workspacesDir = resolveWorkspacesDir({ dataDir, home })
  const cliHomesDir = join(dataDir, 'cli-homes')
  const vaultDir = join(dataDir, 'vault')

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
    workspacesDir,
    cliHomesDir,
    vaultDir,
  }
}

/**
 * True when `dir` or any of its ancestors holds a `.git` entry (a work tree
 * or a worktree/submodule `.git` file). `dir` itself need not exist yet.
 */
export function hasGitAncestor(dir: string): boolean {
  let current = resolve(dir)
  for (;;) {
    if (existsSync(join(current, '.git'))) return true
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
}

export interface ResolveWorkspacesDirInput {
  dataDir: string
  home: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** The OS user's home directory (default os.homedir()). */
  userHome?: string
}

/** Per-user application data base: where an app keeps data outside any checkout. */
function userDataBase(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, userHome: string): string {
  if (platform === 'darwin') return join(userHome, 'Library', 'Application Support')
  if (platform === 'win32') return env.LOCALAPPDATA?.trim() || join(userHome, 'AppData', 'Local')
  const xdg = env.XDG_DATA_HOME?.trim()
  return xdg && isAbsolute(xdg) ? xdg : join(userHome, '.local', 'share')
}

/**
 * Stable per-instance key: readable name of the instance home plus a hash of
 * the data dir, so two instances on one machine (dev and live) never share
 * a workspaces root.
 */
function instanceKey(dataDir: string, home: string): string {
  const name = basename(resolve(home)).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'eyas'
  const hash = createHash('sha256').update(resolve(dataDir)).digest('hex').slice(0, 12)
  return `${name}-${hash}`
}

/**
 * Where EYAS-created workspaces live.
 *
 * A CLI started inside a git work tree treats that repository as its project:
 * it loads the repo's instruction files, git status and permission rules, and
 * shares the operator's own per-project memory scope. The data dir of a
 * source install IS inside a git checkout, so workspaces must not simply sit
 * under it. Order:
 *   1. EYAS_WORKSPACES_DIR (the operator's explicit choice, honoured as is)
 *   2. <dataDir>/workspaces when no git work tree encloses it (Docker, packaged installs)
 *   3. <user data base>/eyas/<instance>/workspaces otherwise
 */
export function resolveWorkspacesDir(input: ResolveWorkspacesDirInput): string {
  const env = input.env ?? process.env
  const override = env.EYAS_WORKSPACES_DIR?.trim()
  if (override) return resolve(override)
  const inData = join(input.dataDir, 'workspaces')
  if (!hasGitAncestor(inData)) return inData
  const base = userDataBase(env, input.platform ?? process.platform, input.userHome ?? homedir())
  return join(base, 'eyas', instanceKey(input.dataDir, input.home), 'workspaces')
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
