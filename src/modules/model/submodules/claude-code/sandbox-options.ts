// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Claude Code's kernel file sandbox for one query with tools (B5): the SDK
// `sandbox` option, which reaches the CLI as flag settings. It wraps every
// shell command the CLI runs (Seatbelt on macOS, bubblewrap + socat on
// Linux); Claude Code's own Read/Edit/Grep are covered by the memory-policy
// PreToolUse hook instead (memory-path-hook.ts).
//
//   'required' → enabled, failIfUnavailable (the CLI refuses to start rather
//                than run unsandboxed), allowUnsandboxedCommands false (SDK
//                0.2.89 sdk.d.ts: "the dangerouslyDisableSandbox parameter is
//                completely ignored"): no command ever leaves the sandbox.
//   'auto'     → enabled, failIfUnavailable false, allowUnsandboxedCommands
//                true, so a command that needs ~/.npm is not a dead end — but
//                every call that asks to leave goes to a human (the
//                permission bridge's requireHuman), never to the judge.
// autoAllowBashIfSandboxed is always false: every Bash call still reaches
// canUseTool and the gate.
//
// filesystem.denyRead/denyWrite are the memory-sovereignty deny list
// (path-policy kernelDenyList); allowWrite are the query's working folders;
// allowRead re-opens, for reading only, Claude Code's own shell state and
// binary folder (claudeSandboxKeeps).
// Paths are written `//<absolute>`: both the sandbox-settings reader and the
// permission-rule reader of Claude Code take a leading `//` as the filesystem
// root (2.1.280), while a single `/` is relative to the settings file in the
// latter.

import { dirname, join, resolve } from 'node:path'
import { realpathBestEffort } from '@shared/fs-realpath.js'
import type { CliSandboxMode } from '../../cli-runtime/sandbox/types.js'

/** The subset of the SDK's SandboxSettings EYAS sets. */
export interface ClaudeSandboxSettings {
  enabled: true
  failIfUnavailable: boolean
  autoAllowBashIfSandboxed: false
  allowUnsandboxedCommands: boolean
  filesystem: {
    denyRead: string[]
    denyWrite: string[]
    allowWrite: string[]
    /** Re-allowed for reading inside a denied region (Claude Code: takes precedence over denyRead). */
    allowRead: string[]
  }
}

export interface ClaudeSandboxInput {
  mode: CliSandboxMode
  /** Absolute paths to deny for reading and writing (kernelDenyList). */
  denyPaths: readonly string[]
  /** The query's working folders: writable inside the sandbox. */
  writableDirectories: readonly string[]
  /**
   * Folders inside a denied region the shell must still read (claudeSandboxKeeps,
   * filtered by exemptableDirs so none shelters a protected store). Writes
   * there stay denied.
   */
  readableDirectories?: readonly string[]
}

/** `//<absolute path>`: the filesystem root to every Claude Code path reader. */
export function claudeSandboxPath(path: string): string {
  return `/${resolve(path)}`
}

function uniqueSorted(paths: readonly string[]): string[] {
  return [...new Set(paths.map(claudeSandboxPath))].sort()
}

/** The sandbox option of one query with tools. */
export function buildClaudeSandboxSettings(input: ClaudeSandboxInput): ClaudeSandboxSettings {
  const deny = uniqueSorted(input.denyPaths)
  const required = input.mode === 'required'
  return {
    enabled: true,
    failIfUnavailable: required,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: !required,
    filesystem: {
      denyRead: deny,
      denyWrite: [...deny],
      allowWrite: uniqueSorted(input.writableDirectories),
      allowRead: uniqueSorted(input.readableDirectories ?? []),
    },
  }
}

/**
 * What must stay readable inside the sandbox although it may lie in a denied
 * store: Claude Code's own per-session shell state under ~/.claude (the shell
 * snapshot every sandboxed command sources and the session env — no
 * conversation content, A1 spike host-writes fixture) and the folders of the
 * Claude Code binary. Re-allowed with allowRead rather than cut out of the
 * deny list, so ~/.claude itself stays denied as a whole (a folder created
 * later included) and nothing of the store is listed to build the rules.
 */
export function claudeSandboxKeeps(opts: { homeDir: string; executable: string }): string[] {
  const keeps = new Set([
    join(opts.homeDir, '.claude', 'shell-snapshots'),
    join(opts.homeDir, '.claude', 'session-env'),
    dirname(resolve(opts.executable)),
  ])
  try {
    keeps.add(dirname(realpathBestEffort(opts.executable)))
  } catch {
    // The resolved path alone.
  }
  return [...keeps]
}
