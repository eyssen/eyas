// Part of eYssen. See LICENSE file for full copyright and licensing details.

// Implementation moved to the shared model-level bridge so the grok-cli ACP
// provider enforces the exact same Cap 7 policy. Re-exported here to keep the
// established import path stable.
export * from '../../permission-bridge.js'
