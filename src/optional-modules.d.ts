// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Ambient declarations for optional integration packages.
 *
 * These modules are *not* in package.json dependencies — the providers/adapters
 * that use them load them dynamically and gracefully degrade when they are
 * missing at runtime. We declare them here as `any` so the TypeScript compiler
 * accepts the dynamic import call sites without forcing the packages into the
 * production dependency tree.
 *
 * If we ever add any of these as a real dependency, delete its block here and
 * the real @types package (or shipped types) will take over.
 */

declare module 'imapflow' {
  export const ImapFlow: any
  const _default: any
  export default _default
}

declare module 'discord.js' {
  export const Client: any
  export const GatewayIntentBits: any
  const _default: any
  export default _default
}

declare module '@slack/bolt' {
  export const App: any
  const _default: any
  export default _default
}

