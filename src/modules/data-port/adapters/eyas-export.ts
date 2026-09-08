// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { classifyPath, posix } from '../scanners/heuristics.js'
import type { ProviderAdapter } from './types.js'

export const eyasExportAdapter: ProviderAdapter = {
  id: 'eyas-export',
  rootHints: ['<unzipped eyas-export-v1 bundle>'],
  detect: (paths) => {
    const l = paths.map(posix)
    return l.includes('manifest.json') && l.some((p) => p.startsWith('vault/')) ? 0.95 : 0
  },
  classify: (rel, head) => {
    const p = posix(rel)
    if (!(p.startsWith('vault/') || p === 'manifest.json')) return null
    return classifyPath(rel, head, 'eyas-export')
  },
}
