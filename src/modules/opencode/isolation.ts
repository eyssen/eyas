// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The OpenCode sidecar runs in an EYAS-owned home (`<dataDir>/cli-homes/
// opencode`, created by cli-runtime/homes.ts), never in the operator's:
//
//   HOME             the EYAS home itself — OpenCode also reads ~/.claude/
//                    CLAUDE.md, ~/.opencode and writes an npm cache to ~/.npm
//                    even with every XDG_* folder redirected (W0 spike,
//                    tests/fixtures/cli/opencode/1.18.29/isolation-run.json)
//   XDG_CONFIG_HOME  <home>/config  (opencode.json, written by EYAS)
//   XDG_DATA_HOME    <home>/data    (auth.json — the EYAS sign-in — and sessions)
//   XDG_STATE_HOME   <home>/state
//   XDG_CACHE_HOME   <home>/cache   (npm_config_cache too)
//
// The environment is built from the cli-runtime allowlist (no host provider
// keys, no CLAUDECODE / CLAUDE_CODE_* switches, no host XDG_* folders), plus
// the switches that keep host Claude Code instructions and skills, external
// skills and project config out, and OPENCODE_PERMISSION set to "ask" for
// every tool so a headless task can be answered by the EYAS gate.
//
// Names verified in the 1.18.29 binary (fixture env-flags.json).
//
// The EYAS memory plugin sits below config/opencode/: OpenCode installs its
// `@opencode-ai/plugin` dependency into config/opencode/node_modules, and the
// plugin's import resolves only from a file under that folder. (At the
// earlier <home>/plugins/ it never resolved, so 1.18.29 skipped the plugin
// without a word — the live lane's OpenCode case proves the new place.) It
// is not OpenCode's auto-loaded plugin(s)/ folder, so it loads exactly once,
// from the managed config's plugin list.

import { randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { buildCliEnv } from '@modules/model/cli-runtime/env.js'
import { writeManagedFiles, type WriteManagedFilesResult } from '@modules/model/cli-runtime/homes.js'
import { EYAS_MEMORY_PLUGIN_SOURCE, OPENCODE_SERVER_PASSWORD_ENV } from './plugin-source.js'
import { OPENCODE_KEY_FD, OPENCODE_KEY_FD_ENV } from './plugin-tokens.js'

/** Switches that keep host configuration out of the sidecar. */
export const OPENCODE_ISOLATION_FLAGS: Readonly<Record<string, string>> = {
  // ~/.claude/CLAUDE.md, ~/.claude skills and the rest of the Claude Code compat layer.
  OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: '1',
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
  // ~/.agents and other external skill folders.
  OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
  // The project's opencode.json, .opencode/ and AGENTS.md / CLAUDE.md / CONTEXT.md.
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_DISABLE_SHARE: '1',
}

/**
 * Tool permissions that ask before running (fixture permission-config-keys:
 * todowrite, question and doom_loop take a flat action and are left at
 * OpenCode's defaults).
 */
export const OPENCODE_ASK_PERMISSIONS = [
  'read', 'edit', 'glob', 'grep', 'list', 'bash', 'task',
  'external_directory', 'webfetch', 'websearch', 'lsp', 'skill',
] as const

export const OPENCODE_PERMISSION_CONFIG: Readonly<Record<string, 'ask'>> = Object.fromEntries(
  OPENCODE_ASK_PERMISSIONS.map((key) => [key, 'ask' as const]),
)

/** Where everything sits inside the EYAS-owned OpenCode home. */
export interface OpencodeHomeLayout {
  home: string
  config: string
  data: string
  state: string
  cache: string
  npmCache: string
  /** The managed global config (relative to the home). */
  configFile: string
  /** The EYAS memory plugin (relative to the home). */
  pluginFile: string
}

/** Where earlier versions wrote the plugin (relative to the home): removed, never loaded. */
const RETIRED_PLUGIN_FILE = join('plugins', 'eyas-memory.ts')

export function opencodeHomeLayout(home: string): OpencodeHomeLayout {
  return {
    home,
    config: join(home, 'config'),
    data: join(home, 'data'),
    state: join(home, 'state'),
    cache: join(home, 'cache'),
    npmCache: join(home, 'cache', 'npm'),
    configFile: join('config', 'opencode', 'opencode.json'),
    pluginFile: join('config', 'opencode', 'eyas', 'eyas-memory.ts'),
  }
}

/** Create a private sub-folder of the home; refuses a symlink planted there. */
function ensurePrivateSubdir(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error(`OpenCode home folder is a symbolic link: ${path}`)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  mkdirSync(path, { recursive: true, mode: 0o700 })
}

/** Remove the plugin copy an earlier version left at <home>/plugins (a regular file only). */
function removeRetiredPlugin(home: string): void {
  const file = join(home, RETIRED_PLUGIN_FILE)
  try {
    if (lstatSync(file).isFile()) unlinkSync(file)
  } catch {
    return
  }
  try {
    const dir = join(home, 'plugins')
    if (lstatSync(dir).isDirectory() && readdirSync(dir).length === 0) rmdirSync(dir)
  } catch {
    // Not ours to force.
  }
}

/**
 * Write the managed opencode.json (loads only the EYAS memory plugin) and the
 * plugin itself. Always written — there is no "inherit my own config" mode.
 * Idempotent: unchanged files are not rewritten.
 */
export function writeOpencodeManagedFiles(home: string): WriteManagedFilesResult {
  const layout = opencodeHomeLayout(home)
  for (const dir of [layout.data, layout.state, layout.cache]) ensurePrivateSubdir(dir)
  removeRetiredPlugin(home)
  const pluginUrl = `file://${join(home, layout.pluginFile)}`
  return writeManagedFiles(home, [
    { path: layout.pluginFile, content: EYAS_MEMORY_PLUGIN_SOURCE },
    {
      path: layout.configFile,
      content: `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', plugin: [pluginUrl] }, null, 2)}\n`,
    },
  ])
}

export interface BuildOpencodeEnvOptions {
  /** The EYAS-owned OpenCode home (cliHome('opencode')). */
  home: string
  /** EYAS base URL for the memory plugin. */
  eyasBaseUrl: string
  /**
   * The process gets its memory-plugin key on fd 3 (plugin-tokens.ts): only
   * the marker that says so goes into the environment, never the key.
   * Absent: no marker, and an inherited one is dropped.
   */
  pluginKeyOnFd?: boolean
  /** Basic-auth password of the spawned `opencode serve` (and its TUI clients). */
  serverPassword?: string
  /** GIT_CEILING_DIRECTORIES (default: the instance workspaces root). */
  workspacesRoot?: string
  /** Source environment (default process.env). */
  source?: NodeJS.ProcessEnv
}

/** The complete child environment of an OpenCode process EYAS starts. */
export function buildOpencodeEnv(opts: BuildOpencodeEnvOptions): Record<string, string> {
  const layout = opencodeHomeLayout(opts.home)
  return buildCliEnv('opencode', {
    home: opts.home,
    source: opts.source,
    workspacesRoot: opts.workspacesRoot,
    extra: {
      XDG_CONFIG_HOME: layout.config,
      XDG_DATA_HOME: layout.data,
      XDG_STATE_HOME: layout.state,
      XDG_CACHE_HOME: layout.cache,
      npm_config_cache: layout.npmCache,
      ...OPENCODE_ISOLATION_FLAGS,
      OPENCODE_PERMISSION: JSON.stringify(OPENCODE_PERMISSION_CONFIG),
      EYAS_OPENCODE_EYAS_URL: opts.eyasBaseUrl,
      [OPENCODE_KEY_FD_ENV]: opts.pluginKeyOnFd ? String(OPENCODE_KEY_FD) : undefined,
      [OPENCODE_SERVER_PASSWORD_ENV]: opts.serverPassword,
    },
  })
}

export interface TuiCommandOptions {
  /** The OpenCode executable. */
  file: string
  /** The EYAS-owned OpenCode home (cliHome('opencode')). */
  home: string
  eyasBaseUrl: string
  workspacesRoot?: string
  /** A free loopback port for the TUI's own server. */
  pickPort: () => Promise<number>
  /** Source environment (default process.env). */
  source?: NodeJS.ProcessEnv
}

/**
 * How EYAS starts an OpenCode terminal (TUI). The TUI runs its own OpenCode
 * server in its own process — it does not attach to the headless `opencode
 * serve` of EYAS tasks — so it gets a loopback port and a server password of
 * its own, never the headless server's: a shell the TUI's model runs
 * inherits nothing that opens the sessions of EYAS tasks. Same EYAS-owned
 * home and isolated environment as the headless server; its memory-plugin
 * key is minted by the PTY manager and handed over on the TUI's fd 3.
 */
export async function buildTuiCommand(opts: TuiCommandOptions): Promise<{ file: string; args: string[]; env: Record<string, string> }> {
  writeOpencodeManagedFiles(opts.home)
  const port = await opts.pickPort()
  const env = buildOpencodeEnv({
    home: opts.home,
    eyasBaseUrl: opts.eyasBaseUrl,
    serverPassword: randomBytes(24).toString('hex'),
    workspacesRoot: opts.workspacesRoot,
    source: opts.source,
  })
  env.TERM = 'xterm-256color'
  return { file: opts.file, args: ['--hostname', '127.0.0.1', '--port', String(port)], env }
}

export interface ShellCommandOptions {
  /** The EYAS-owned OpenCode home (cliHome('opencode')): the shell's HOME. */
  home: string
  eyasBaseUrl: string
  workspacesRoot?: string
  /** Source environment (default process.env). */
  source?: NodeJS.ProcessEnv
}

/**
 * How EYAS starts a plain shell in the terminal panel (`kind: 'shell'`, for
 * the owner and admins only — routes.ts). A login shell of the host's $SHELL
 * (else /bin/bash) with the OpenCode terminal's environment, built from the
 * same allowlist (buildOpencodeEnv), never the server's process.env: no
 * EYAS_MASTER_KEY, provider API keys or other server secrets, and HOME is the
 * EYAS-owned OpenCode home, so an `opencode` typed there is the isolated one.
 * No server password and no memory-plugin key. It is not a filesystem
 * sandbox: the shell runs as the EYAS server's OS user.
 */
export function buildShellCommand(opts: ShellCommandOptions): { file: string; args: string[]; env: Record<string, string> } {
  const env = buildOpencodeEnv({
    home: opts.home,
    eyasBaseUrl: opts.eyasBaseUrl,
    workspacesRoot: opts.workspacesRoot,
    source: opts.source,
  })
  env.TERM = 'xterm-256color'
  const shell = env.SHELL?.trim()
  return { file: shell && shell.startsWith('/') ? shell : '/bin/bash', args: ['-l'], env }
}
