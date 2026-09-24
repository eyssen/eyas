// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { classifyPath, posix } from '../scanners/heuristics.js'
import type { ProviderAdapter } from './types.js'

/** Path-segment anchored — `xyz.codeium/…` is not `.codeium/…`. */
const isCodeiumOrWindsurfPath = (p: string) =>
  p.startsWith('.codeium/') || p.includes('/.codeium/') || p.startsWith('.windsurf/') || p.includes('/.windsurf/')

export const windsurfAdapter: ProviderAdapter = {
  id: 'windsurf',
  rootHints: ['~/.codeium/windsurf', '~/.codeium/memories', '<repo>/.windsurf/rules'],
  detect: (paths) => (paths.map(posix).some((p) => isCodeiumOrWindsurfPath(p)) ? 0.8 : 0),
  classify: (rel, head) => {
    const p = posix(rel)
    if (!isCodeiumOrWindsurfPath(p)) return null
    if (/\.codeium\/memories\/global_rules\.md$/.test(p) || /\.windsurf\/rules\/[^/]+\.md$/.test(p)) {
      return {
        kind: 'rule',
        target: 'workspace.agents',
        confidence: 0.9,
        reason: 'Windsurf rules',
        reasonCode: 'rules-file',
        selectedByDefault: true,
      }
    }
    if (/\.codeium\/windsurf\/memories\/[^/]+\.md$/.test(p)) {
      return {
        kind: 'memory',
        target: 'vault.semantic',
        confidence: 0.85,
        reason: 'Windsurf memory',
        reasonCode: 'memory-note',
        selectedByDefault: true,
      }
    }
    if (/\.codeium\/windsurf\/workflows\/[^/]+\.md$/.test(p)) {
      return {
        kind: 'skill',
        target: 'skill',
        confidence: 0.85,
        reason: 'Windsurf workflow — imported as a skill',
        reasonCode: 'skill',
        selectedByDefault: true,
      }
    }
    // Everything else in the tree goes to the shared classifier: a note is a
    // note, a config file is importable config, and only bytes with no text at
    // all come back as noise (R11.3). Nothing under `.codeium/` is app-state by
    // its folder alone any more.
    return classifyPath(rel, head, 'windsurf')
  },
}
