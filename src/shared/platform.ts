// Part of eYssen. See LICENSE file for full copyright and licensing details.

export const isBun = typeof globalThis.Bun !== 'undefined'
export const runtime = isBun ? 'bun' : 'node' as const
