// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Linux: bubblewrap. Grok binds a custom profile's deny list over with bwrap
// (and refuses to start without it), and Claude Code's sandbox runs every
// shell command in bwrap with socat carrying its network proxy. Neither tool
// ships with EYAS: bubblewrap is LGPL, so it is the operator's install
// (documented), never a dependency.
//
// A container often has bwrap on PATH but no user namespaces, and then every
// sandboxed start fails. One short probe run (`bwrap --ro-bind / / true`)
// tells the two apart, so such a host shows 'unavailable' instead of a CLI
// that refuses to start.

import type { KernelSandboxStrategy } from './types.js'

/** The smallest sandbox bwrap can build: a read-only view of / running `true`. */
export const BWRAP_PROBE_ARGS: readonly string[] = ['--ro-bind', '/', '/', 'true']

export const linuxBubblewrapStrategy: KernelSandboxStrategy = {
  id: 'linux-bwrap',
  platform: 'linux',
  failureReason: 'bwrap-unusable',
  async detect(cli, host) {
    const bwrap = host.which('bwrap')
    if (!bwrap) return { available: false, reason: 'no-bwrap' }
    if (cli === 'claude-code' && !host.which('socat')) return { available: false, reason: 'no-socat' }
    if (!(await host.probe(bwrap, BWRAP_PROBE_ARGS))) return { available: false, reason: 'bwrap-unusable' }
    return { available: true, reason: 'linux-bwrap' }
  },
}
