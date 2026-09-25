// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Kernel file sandbox for the CLI providers' own tools — the shared
// vocabulary. How a sandbox is made on one operating system lives in exactly
// one strategy per platform (darwin-seatbelt.ts, linux-bubblewrap.ts); the
// providers only learn "available, and why not".

import { z } from 'zod'

/**
 * security.cliSandbox. 'auto' runs the CLI's own tools in the kernel sandbox
 * where one is available and says so when it is not; 'required' refuses a
 * turn with tools when none is available. There is deliberately no 'off'.
 */
export const CliSandboxModeSchema = z.enum(['auto', 'required'])
export type CliSandboxMode = z.infer<typeof CliSandboxModeSchema>

/** The CLI providers whose own tools a kernel sandbox may wrap. */
export type SandboxCli = 'claude-code' | 'grok-cli' | 'kimi-cli'

/** A CLI that can run its tools in a kernel sandbox (Kimi documents none). */
export type SandboxCapableCli = Exclude<SandboxCli, 'kimi-cli'>

/**
 * Why a sandbox is or is not available. Stable ids: the web localizes them
 * (providers.panel.fileSandbox.reason*), doctor prints them.
 */
export const KERNEL_SANDBOX_REASONS = [
  /** macOS Seatbelt — available. */
  'darwin-seatbelt',
  /** Linux bubblewrap — available. */
  'linux-bwrap',
  /** Linux without bubblewrap (bwrap) on PATH. */
  'no-bwrap',
  /** Linux with bubblewrap but without socat, which Claude Code's sandbox also needs. */
  'no-socat',
  /** bubblewrap is installed but cannot create a sandbox here (user namespaces disabled). */
  'bwrap-unusable',
  /** An operating system with no supported sandbox. */
  'unsupported-platform',
  /** The CLI offers no kernel sandbox at all. */
  'cli-has-none',
] as const
export type KernelSandboxReason = typeof KERNEL_SANDBOX_REASONS[number]

export interface KernelSandboxAvailability {
  available: boolean
  reason: KernelSandboxReason
}

/** What a strategy may ask of the host: PATH lookups and one short probe run. */
export interface SandboxHostDeps {
  platform: NodeJS.Platform
  /** Absolute path of an executable found on PATH, or null. */
  which(name: string): string | null
  /** Run `bin args` once, briefly, without a shell; true when it exits 0. */
  probe(bin: string, args: readonly string[]): Promise<boolean>
}

/** How one operating system provides the kernel sandbox. */
export interface KernelSandboxStrategy {
  readonly id: string
  readonly platform: NodeJS.Platform
  /** The reason reported when detection itself fails (never 'available'). */
  readonly failureReason: KernelSandboxReason
  detect(cli: SandboxCapableCli, host: SandboxHostDeps): Promise<KernelSandboxAvailability>
}

/** What the provider panel and doctor show for one CLI. */
export type FileSandboxStatus = 'active' | 'unavailable' | 'unsupported'

export interface FileSandboxInfo {
  status: FileSandboxStatus
  reason: KernelSandboxReason
  mode: CliSandboxMode
}
