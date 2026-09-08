// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { classifyPath, posix } from '../scanners/heuristics.js'
import type { ProviderAdapter } from './types.js'

export const geminiCliAdapter: ProviderAdapter = {
  id: 'gemini-cli',
  rootHints: ['~/.gemini', '<repo>/GEMINI.md'],
  detect: (paths) => (paths.map(posix).some((p) => p === 'gemini.md' || p.startsWith('.gemini/') || p.includes('/.gemini/')) ? 0.8 : 0),
  classify: (rel, head) => {
    const p = posix(rel)
    const base = p.split('/').pop() ?? p
    if (base === 'gemini.md') {
      return {
        kind: 'rule',
        target: 'workspace.agents',
        confidence: 0.9,
        reason: 'Gemini CLI context / memory file',
        reasonCode: 'rules-file',
        selectedByDefault: true,
      }
    }
    if (!(p.startsWith('.gemini/') || p.includes('/.gemini/'))) return null
    // Only the IDE's own binary state is app-state. A note the owner wrote under
    // `antigravity/` is a note, and the shared classifier says what kind (R11.3).
    if (p.includes('/antigravity/') && /\.(pb|lock|db|sqlite)$/.test(p)) {
      return {
        kind: 'noise',
        target: 'none',
        confidence: 0.9,
        reason: 'Antigravity IDE state (protobuf / lock) — not importable text',
        reasonCode: 'app-state',
        selectedByDefault: false,
      }
    }
    return classifyPath(rel, head, 'gemini-cli')
  },
}
