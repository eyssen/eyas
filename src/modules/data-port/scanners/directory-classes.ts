// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D-9: the ONLY directory classes the walker does not enter. A stricter marker
// makes the walker map MORE, never less (P-4). Everything else is walked.

import { readdirSync } from 'node:fs'
import { basename } from 'node:path'
import { PROGRESS_EVERY_DIRS, PROGRESS_EVERY_FILES } from '../constants.js'
import type { DirectoryClass } from '../types.js'

const VCS = new Set(['.git', '.hg', '.svn'])
const VENV = new Set(['.venv', 'venv'])
const BUILD_DIRS = new Set(['dist', 'build', 'out', '.next', '.turbo', 'target'])
export const BUILD_MANIFESTS = new Set([
  'package.json',
  'tsconfig.json',
  'Cargo.toml',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'go.mod',
  'build.gradle',
  'build.gradle.kts',
  'pom.xml',
  'CMakeLists.txt',
  'Makefile',
  'deno.json',
  'bun.lockb',
  'bun.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
])
const TRASH = new Set(['.Trash', '.Trashes', '$RECYCLE.BIN'])
const PACKAGE_CACHE_ROOTS = new Set([
  '.pub-cache',
  '.rustup',
  '.cargo',
  '.bun',
  '.npm',
  '.pnpm-store',
])
const EDITOR_EXTENSION_PARENTS = new Set(['.vscode', '.cursor', '.antigravity'])

/**
 * A cloud provider's own marker inside its sync root, for the legacy top-level
 * locations (`~/Dropbox`, `~/OneDrive - Company`). Keyed on CONTENT rather than
 * on the folder name, the way `isBrowserProfile` is: a folder somebody happens
 * to have called `Dropbox` is theirs, and gets walked.
 */
const CLOUD_MARKERS = new Set([
  '.dropbox',
  '.dropbox.cache',
  // OneDrive writes this GUID-named marker at the root of every sync folder.
  '.849C9593-D756-4E56-8D6E-42412F2A707B',
])

/**
 * A sync root whose contents are PLACEHOLDERS (A-66).
 *
 * macOS puts every File Provider under `~/Library/CloudStorage` and iCloud
 * Drive under `~/Library/Mobile Documents`, so those two are structural: the
 * NAME alone would be a guess, the name UNDER `Library` is the platform's own
 * layout. The legacy roots are found by the provider's marker file instead.
 *
 * Being a class means one counted, visible row — not a hidden one — and a scan
 * pointed straight at the folder still walks it, because the scan root is never
 * classified (D-9).
 */
function isCloudStorage(names: Set<string>, children: Set<string>, parentPath: string): boolean {
  const parent = basename(parentPath)
  if (parent === 'Library' && (names.has('CloudStorage') || names.has('Mobile Documents'))) return true
  return [...children].some((c) => CLOUD_MARKERS.has(c))
}

function isBrowserProfile(children: Set<string>): boolean {
  // Chromium user-data root
  if (children.has('Local State') && children.has('Default')) return true
  // Chromium profile
  if (
    children.has('Preferences') &&
    (children.has('History') || children.has('Cookies') || children.has('Web Data'))
  ) {
    return true
  }
  // Firefox profile
  if (children.has('prefs.js') && children.has('places.sqlite')) return true
  return false
}

/**
 * `name` is the entry name as reached; `realDir` the resolved directory (a link
 * into node_modules is still node_modules); `childNames` its real entries;
 * `siblingNames` the parent's entries; `parentPath` the parent as reached.
 */
export function classifyDirectory(
  name: string,
  realDir: string,
  childNames: readonly string[],
  siblingNames: readonly string[],
  parentPath: string,
): DirectoryClass | null {
  const names = new Set([name, basename(realDir)])
  const children = new Set(childNames)
  const siblings = new Set(siblingNames)
  if (names.has('node_modules')) return 'node_modules'
  if ([...names].some((n) => VCS.has(n))) return 'vcs'
  if (names.has('.cache')) return 'cache'
  if (names.has('__pycache__')) return 'pycache'
  if ([...names].some((n) => VENV.has(n))) return 'venv'
  if (
    [...names].some((n) => BUILD_DIRS.has(n)) &&
    [...siblings].some((s) => BUILD_MANIFESTS.has(s))
  ) {
    return 'build-output'
  }
  if (isBrowserProfile(children)) return 'browser-profile'
  if ([...names].some((n) => TRASH.has(n))) return 'trash'
  if (names.has('Trash') && parentPath.replace(/\\/g, '/').endsWith('/.local/share')) return 'trash'
  if (names.has('Caches') && basename(parentPath) === 'Library') return 'os-cache'
  if (isCloudStorage(names, children, parentPath)) return 'cloud-storage'
  if ([...names].some((n) => n.endsWith('.photoslibrary'))) return 'photos-library'
  if ([...names].some((n) => PACKAGE_CACHE_ROOTS.has(n))) return 'package-cache'
  if (name === 'site-packages') return 'package-cache'
  const parent = basename(parentPath)
  const posixParent = parentPath.replace(/\\/g, '/')
  if (name === 'registry' && parent === '.cargo') return 'package-cache'
  if (name === 'git' && parent === '.cargo') return 'package-cache'
  if (name === 'cache' && (posixParent.endsWith('/.bun/install') || parent === '.bun')) return 'package-cache'
  if (name === 'install' && parent === '.bun') return 'package-cache'
  if (name === 'session-stats' && parent === '.claude') return 'tool-ephemera'
  if (name === 'marketplace-cache' && parent === '.grok') return 'tool-ephemera'
  if (name === '.tmp' && parent === '.codex') return 'tool-ephemera'
  if (name === 'extensions' && EDITOR_EXTENSION_PARENTS.has(parent)) return 'tool-ephemera'
  if (name === 'cache' && parent === 'plugins') return 'tool-ephemera'
  if (name.startsWith('eyas-memory-backup-')) return 'tool-ephemera'
  return null
}

export interface TreeCount {
  files: number
  dirs: number
  unreadable: number
}

/**
 * Everything under a class directory, counted with readdir only — no stat, no
 * read, no symlink following (a link inside node_modules is a file to this
 * count). Iterative, so depth never matters; no cap, the cost is time (R11.1).
 * A generator: it yields `'tick'` every PROGRESS_EVERY_DIRS directories or
 * PROGRESS_EVERY_FILES entries so the walker can forward the tick and the
 * driver can yield to the event loop — a million-entry `Library/Caches` or
 * `node_modules` must never freeze the server (P-9).
 */
export function* countTree(dir: string): Generator<'tick', TreeCount> {
  const out: TreeCount = { files: 0, dirs: 0, unreadable: 0 }
  const stack = [dir]
  let dirsSinceTick = 0
  let entriesSinceTick = 0
  while (stack.length) {
    const current = stack.pop()!
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      out.unreadable++
      continue
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        out.dirs++
        stack.push(`${current}/${String(e.name)}`)
      } else {
        // Regular files and symlinks alike: a link is never followed here.
        out.files++
      }
      if (++entriesSinceTick >= PROGRESS_EVERY_FILES) {
        entriesSinceTick = 0
        yield 'tick'
      }
    }
    if (++dirsSinceTick >= PROGRESS_EVERY_DIRS) {
      dirsSinceTick = 0
      yield 'tick'
    }
  }
  return out
}

/** Drains `countTree` — tests and the synchronous upload path. */
export function collectCount(dir: string): TreeCount {
  const g = countTree(dir)
  let n = g.next()
  while (!n.done) n = g.next()
  return n.value
}

export const SPECIAL_TEXT_NAMES = new Set([
  'claude.md',
  'agents.md',
  'gemini.md',
  'global_rules.md',
  'skill.md',
  'memory.md',
  'soul.md',
  'identity.md',
  'tools.md',
  '.cursorrules',
  '.gitignore',
  '.editorconfig',
  'makefile',
  'dockerfile',
  'license',
  'licence',
  'readme',
  'copying',
  'authors',
  'notice',
])
const APP_STATE_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.localized'])
const DERIVED_DB_EXT = /\.(sqlite|sqlite-wal|sqlite-shm|db|ldb)$/i
const BINARY_EXTS = new Set(
  (
    'png jpg jpeg gif webp heic heif bmp ico tif tiff psd ai pdf zip gz tgz bz2 xz 7z rar dmg pkg iso img ' +
    'exe dll so dylib o a lib class jar war wasm woff woff2 ttf otf eot mp3 m4a wav flac ogg mp4 mov mkv ' +
    'avi webm pyc pyo pyd pb bin dat db-journal p12 pfx xls xlsx'
  )
    .split(' ')
    .map((e) => `.${e}`),
)
const TEXT_EXTS = new Set(
  (
    'md markdown mdown txt text rst adoc org xml html htm csv tsv ini cfg conf plist mdc yaml yml toml ' +
    'json jsonl lock ts tsx js jsx mjs cjs py rb go rs java kt swift c h cpp hpp cs php sql css scss less ' +
    'vue svelte tex bib log pl lua r m gradle properties bat ps1 sh zsh bash fish env pem key crt cer map'
  )
    .split(' ')
    .map((e) => `.${e}`),
)

/** Every regular file is a row; the name decides only whether its BYTES are read. */
export function nameClass(name: string): 'text' | 'binary' | 'derived-db' | 'app-state' | 'unknown' {
  const lower = name.toLowerCase()
  if (APP_STATE_NAMES.has(lower)) return 'app-state'
  if (SPECIAL_TEXT_NAMES.has(lower) || lower === '.env' || lower.startsWith('.env.') || lower.endsWith('.env')) {
    return 'text'
  }
  if (DERIVED_DB_EXT.test(lower)) return 'derived-db'
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return 'unknown'
  const ext = lower.slice(dot)
  if (BINARY_EXTS.has(ext)) return 'binary'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'unknown'
}
