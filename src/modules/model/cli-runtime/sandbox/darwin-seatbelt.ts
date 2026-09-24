// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// macOS: Seatbelt, part of every macOS release. Grok applies it to its own
// process at start (sandbox_init); Claude Code wraps each shell command with
// the system's sandbox-exec. Nothing to install, nothing to probe.

import type { KernelSandboxStrategy } from './types.js'

export const darwinSeatbeltStrategy: KernelSandboxStrategy = {
  id: 'darwin-seatbelt',
  platform: 'darwin',
  failureReason: 'unsupported-platform',
  async detect() {
    return { available: true, reason: 'darwin-seatbelt' }
  },
}
