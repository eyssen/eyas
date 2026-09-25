// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Grok's kernel file sandbox for one session (B5): a custom profile in
// $GROK_HOME/sandbox.toml, selected with GROK_SANDBOX=<name> at the spawn.
// grok applies it to its whole process at start (Seatbelt on macOS,
// Landlock + bubblewrap on Linux), so its shell, grep, list_dir and subagent
// reads — the ones that read the disk directly once approved — are held to
// it too (grok 1.0.41 docs, 18-sandbox.md).
//
// The profile:
//   extends    'workspace' — read everywhere, write the cwd, $GROK_HOME and
//              the temp dirs. Not 'strict': it blocks every non-cwd read and,
//              on Linux, child networking, which breaks ordinary coding turns.
//   deny       the memory-sovereignty deny list (path-policy
//              kernelDenyList): memory outside EYAS, EYAS's private data, the
//              other CLI homes, other conversations' workspaces. Kernel
//              enforced for read AND write/rename. Concrete, glob-free paths
//              only: a path with a glob character (or edge whitespace, which
//              grok skips) is replaced by its parent folder.
//   read_write the session's other working folders and the EYAS-owned CLI
//              HOME, where the CLI's shell keeps ~/.cache and ~/.npm.
// Never denied: the whole EYAS-owned CLI HOME (GROK_HOME lives in it) and the
// folders of the grok binary itself.
//
// The name is eyas-<hash of the body>, so the same folders give the same
// name. Every live session's profile stays in the file until that session
// ends (grok reads the file when it starts); the file is rewritten whole,
// atomically (temp + rename, writeManagedFiles), and only when it changes.
// Writes are synchronous, so two turns in this one process can never
// interleave a read-modify-write — that is the mutex.

import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { realpathBestEffort } from '@shared/fs-realpath.js'
import { writeManagedFiles } from '../../cli-runtime/homes.js'

/** The file grok reads custom profiles from, inside GROK_HOME. */
export const GROK_SANDBOX_FILE = 'sandbox.toml'

/** Profile names EYAS writes. Never a built-in name ('off', 'workspace', …). */
export const GROK_SANDBOX_PROFILE_PREFIX = 'eyas-'
const PROFILE_NAME_RE = /^eyas-[0-9a-f]{16}$/

/** The built-in profile every EYAS profile extends. */
export const GROK_SANDBOX_BASE = 'workspace'

const HEADER = [
  '# Managed by EYAS. Rewritten for every Grok turn; local edits are replaced.',
  '# One profile per running session: the memory-sovereignty deny list plus',
  "# the session's extra working folders.",
].join('\n')

const GLOB_CHARS_RE = /[*?[]/

export interface GrokSandboxProfileInput {
  /** Absolute paths to kernel-deny (read and write). */
  deny: readonly string[]
  /** Absolute folders to grant read-write on top of the base profile. */
  readWrite: readonly string[]
}

export interface GrokSandboxProfile {
  name: string
  deny: string[]
  readWrite: string[]
  /** The TOML table, header line included. */
  body: string
}

/** A TOML basic string: backslash, quote and control characters escaped. */
export function tomlString(value: string): string {
  let out = '"'
  for (const ch of value) {
    const code = ch.codePointAt(0) as number
    if (ch === '\\') out += '\\\\'
    else if (ch === '"') out += '\\"'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\r') out += '\\r'
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return `${out}"`
}

function hasEdgeWhitespace(value: string): boolean {
  return value !== value.trim()
}

/**
 * The deny entry for one path: absolute and normalized; a path grok would
 * read as a glob (`*`, `?`, `[`) or skip (edge whitespace) becomes its
 * nearest clean parent. Null for the filesystem root — denying it would
 * leave no usable machine, and kernelDenyList never asks for it.
 */
export function grokDenyEntry(path: string): string | null {
  let p = resolve(path)
  while (GLOB_CHARS_RE.test(p) || p.split('/').some(hasEdgeWhitespace)) {
    const parent = dirname(p)
    if (parent === p) return null
    p = parent
  }
  return p === '/' ? null : p
}

/** A read_write grant: literal folders only; grok skips globs and edge whitespace, so they are dropped here. */
function readWriteEntry(path: string): string | null {
  const p = resolve(path)
  if (GLOB_CHARS_RE.test(p) || p.split('/').some(hasEdgeWhitespace) || p === '/') return null
  return p
}

function realOrSelf(path: string): string {
  try {
    return realpathBestEffort(path)
  } catch {
    return resolve(path)
  }
}

function uniqueSorted(values: Iterable<string | null>): string[] {
  return [...new Set([...values].filter((v): v is string => typeof v === 'string'))].sort()
}

function tomlArray(values: readonly string[]): string {
  return values.length === 0 ? '[]' : `[\n${values.map((v) => `  ${tomlString(v)},`).join('\n')}\n]`
}

/**
 * Build one profile. The name is a hash of the body, so it is stable for the
 * same folders and never a built-in profile — an empty deny list still gets
 * an eyas-<hash> profile extending 'workspace', never 'off'.
 */
export function buildGrokSandboxProfile(input: GrokSandboxProfileInput): GrokSandboxProfile {
  const deny = uniqueSorted(input.deny.map(grokDenyEntry))
  // Granted as written and through symlinks: the kernel matches the real path.
  const readWrite = uniqueSorted(input.readWrite.flatMap((p) => [readWriteEntry(p), readWriteEntry(realOrSelf(p))]))
  const fields = [
    `extends = ${tomlString(GROK_SANDBOX_BASE)}`,
    `read_write = ${tomlArray(readWrite)}`,
    `deny = ${tomlArray(deny)}`,
  ].join('\n')
  const name = `${GROK_SANDBOX_PROFILE_PREFIX}${createHash('sha256').update(fields).digest('hex').slice(0, 16)}`
  return { name, deny, readWrite, body: `[profiles.${name}]\n${fields}\n` }
}

/** The whole sandbox.toml for these profiles (sorted by name, so the text is stable). */
export function renderGrokSandboxToml(profiles: Iterable<GrokSandboxProfile>): string {
  const sorted = [...profiles].sort((a, b) => a.name.localeCompare(b.name))
  return `${HEADER}\n${sorted.map((p) => `\n${p.body}`).join('')}`
}

/** Parse with Bun's TOML when present and check each profile landed as built; throws otherwise. */
function assertRendered(text: string, profiles: readonly GrokSandboxProfile[]): void {
  const toml = (globalThis as { Bun?: { TOML?: { parse(s: string): unknown } } }).Bun?.TOML
  if (!toml) return
  const doc = toml.parse(text) as { profiles?: Record<string, { extends?: unknown; deny?: unknown; read_write?: unknown }> }
  for (const p of profiles) {
    const got = doc.profiles?.[p.name]
    const same = (a: unknown, b: readonly string[]) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i])
    if (!got || got.extends !== GROK_SANDBOX_BASE || !same(got.deny, p.deny) || !same(got.read_write, p.readWrite)) {
      throw new Error(`grok-cli: ${GROK_SANDBOX_FILE} did not render profile ${p.name} as built`)
    }
  }
}

/** The variables that select a profile for one spawn. */
export function grokSandboxEnv(name: string, grokHome: string): Record<string, string> {
  if (!PROFILE_NAME_RE.test(name)) throw new Error(`grok-cli: refusing to select sandbox profile ${JSON.stringify(name)}`)
  let realHome: string
  try {
    realHome = realpathBestEffort(grokHome)
  } catch {
    realHome = resolve(grokHome)
  }
  return {
    GROK_SANDBOX: name,
    // Every shell command still asks EYAS; the sandbox never auto-approves one.
    GROK_SANDBOX_AUTO_ALLOW_BASH: 'false',
    // grok refuses a sandbox on a symlinked GROK_HOME: hand it the real path
    // of the same folder.
    GROK_HOME: realHome,
  }
}

export interface GrokSandboxLease {
  readonly name: string
  /** Added to the turn's spawn env (GROK_SANDBOX, GROK_SANDBOX_AUTO_ALLOW_BASH, GROK_HOME). */
  readonly env: Readonly<Record<string, string>>
  /** The session is over: its profile leaves the file once no other session uses it. Idempotent. */
  release(): void
}

export interface GrokSandboxProfiles {
  acquire(input: GrokSandboxProfileInput): GrokSandboxLease
  /** Names of the profiles live sessions use (tests, diagnostics). */
  liveNames(): string[]
}

interface Live {
  profile: GrokSandboxProfile
  refs: number
}

/** Live profiles per GROK_HOME — shared by every provider instance of this process (a reload builds a new one). */
const liveByHome = new Map<string, Map<string, Live>>()

/**
 * The sandbox profiles of one EYAS-owned Grok home. `home` is the CLI HOME,
 * `configDir` its GROK_HOME (inside it).
 */
export function createGrokSandboxProfiles(opts: {
  home: string
  configDir: string
  logger?: { warn?: (o: unknown, msg?: string) => void }
}): GrokSandboxProfiles {
  const relFile = join(relative(opts.home, opts.configDir), GROK_SANDBOX_FILE)
  const key = resolve(opts.configDir)
  let live = liveByHome.get(key)
  if (!live) {
    live = new Map()
    liveByHome.set(key, live)
  }
  const profiles = live

  const write = (): void => {
    const current = [...profiles.values()].map((l) => l.profile)
    const text = renderGrokSandboxToml(current)
    assertRendered(text, current)
    writeManagedFiles(opts.home, [{ path: relFile, content: text }])
  }

  return {
    acquire(input) {
      const profile = buildGrokSandboxProfile(input)
      const entry = profiles.get(profile.name)
      if (entry) entry.refs++
      else profiles.set(profile.name, { profile, refs: 1 })
      try {
        write()
      } catch (err) {
        const again = profiles.get(profile.name)
        if (again && --again.refs <= 0) profiles.delete(profile.name)
        throw err
      }
      const env = grokSandboxEnv(profile.name, opts.configDir)
      let released = false
      return {
        name: profile.name,
        env,
        release() {
          if (released) return
          released = true
          const held = profiles.get(profile.name)
          if (!held) return
          if (--held.refs > 0) return
          profiles.delete(profile.name)
          try {
            write()
          } catch (err) {
            // A stale profile in the file harms nothing: no session selects it.
            opts.logger?.warn?.({ err: err instanceof Error ? err.message : String(err) }, `grok-cli: pruning ${GROK_SANDBOX_FILE} failed`)
          }
        },
      }
    },
    liveNames: () => [...profiles.keys()].sort(),
  }
}

/** The folders of the grok binary (as resolved and as linked), kept usable under the sandbox. */
export function grokBinaryDirs(executable: string): string[] {
  const dirs = new Set([dirname(resolve(executable))])
  try {
    dirs.add(dirname(realpathBestEffort(executable)))
  } catch {
    // The resolved path alone.
  }
  return [...dirs]
}

/** Tests only: forget every live profile. */
export function resetGrokSandboxProfilesForTests(): void {
  liveByHome.clear()
}
