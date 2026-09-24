// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Vitest setup: every test file sees the same kernel-sandbox host — one that
// has a sandbox (Seatbelt semantics), never probed — whatever machine runs
// the suite, so a CLI provider test behaves the same on a laptop and on a
// Linux CI box without bubblewrap. A test that needs another host passes its
// own (the providers' `sandbox.host`, detectKernelSandbox's `host`).

import { setDefaultSandboxHostForTests } from '@modules/model/cli-runtime/sandbox/index.js'

setDefaultSandboxHostForTests({ platform: 'darwin', which: () => null, probe: async () => false })
