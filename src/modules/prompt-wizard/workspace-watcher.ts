// Part of eYssen. See LICENSE file for full copyright and licensing details.

import chokidar, { type FSWatcher } from 'chokidar'
import { join } from 'node:path'

export interface WorkspaceWatcherOptions {
  dataDir: string
  debounceMs?: number
}

export interface WorkspaceWatcher {
  start(): Promise<void>
  stop(): Promise<void>
  onInvalidate(handler: (agentId: string) => void): () => void
}

export function createWorkspaceWatcher(opts: WorkspaceWatcherOptions): WorkspaceWatcher {
  const handlers = new Set<(agentId: string) => void>()
  const debounceMs = opts.debounceMs ?? 250
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  let watcher: FSWatcher | null = null

  function emit(agentId: string) {
    const existing = pending.get(agentId)
    if (existing) clearTimeout(existing)
    pending.set(
      agentId,
      setTimeout(() => {
        pending.delete(agentId)
        for (const h of handlers) h(agentId)
      }, debounceMs),
    )
  }

  function agentIdFromPath(p: string): string | null {
    const norm = p.replace(/\\/g, '/')
    // Escape special regex chars in dataDir path, then match the agent id segment
    const escapedDir = opts.dataDir.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`${escapedDir}/agents/([^/]+)/`)
    const m = re.exec(norm)
    return m ? (m[1] ?? null) : null
  }

  return {
    async start() {
      watcher = chokidar.watch(join(opts.dataDir, 'agents'), {
        persistent: true,
        ignoreInitial: true,
        // Use function matcher: chokidar v5 does not expand glob patterns in the ignored array.
        // Ignore editor snapshot dirs and atomic-write temp files.
        ignored: (p: string) => p.includes('/.history/') || p.endsWith('.tmp'),
      })
      watcher.on('all', (_event, p) => {
        const id = agentIdFromPath(p)
        if (id) emit(id)
      })
    },

    async stop() {
      if (watcher) {
        await watcher.close()
        watcher = null
      }
      for (const h of pending.values()) clearTimeout(h)
      pending.clear()
    },

    onInvalidate(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
}
