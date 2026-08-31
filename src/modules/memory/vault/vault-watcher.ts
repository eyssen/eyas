// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Vault file watcher built on chokidar.
 *
 * The original implementation used `fs.watch` which is unreliable on Linux
 * (misses events on atomic saves, inconsistent rename handling). Chokidar
 * normalises this across platforms and deduplicates bursts.
 *
 * On every burst we re-run `indexAll()` + `removeStale()` — both are fast
 * because the indexer short-circuits on unchanged file hashes.
 */

import chokidar, { type FSWatcher } from 'chokidar'
import type { Logger } from 'pino'
import type { VaultIndexer } from './vault-indexer.js'

export function createVaultWatcher(vaultPath: string, indexer: VaultIndexer, logger: Logger) {
  let watcher: FSWatcher | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleReindex() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      try {
        const indexed = indexer.indexAll()
        indexer.removeStale()
        if (indexed > 0) logger.info('Vault watcher: re-indexed %d files', indexed)
      } catch (err) {
        logger.warn({ err: String(err) }, 'Vault watcher: reindex failed')
      }
    }, 500)
  }

  return {
    start() {
      if (watcher) return
      watcher = chokidar.watch(vaultPath, {
        ignored: /(^|\/)\.[^/]|node_modules/,   // dotfiles + node_modules
        persistent: true,
        ignoreInitial: true,                     // initial scan handled by indexAll() in onStart
        awaitWriteFinish: {                      // debounce editors that write in chunks
          stabilityThreshold: 200,
          pollInterval: 50,
        },
      })
      watcher
        .on('add', (p) => { if (p.endsWith('.md')) scheduleReindex() })
        .on('change', (p) => { if (p.endsWith('.md')) scheduleReindex() })
        .on('unlink', (p) => { if (p.endsWith('.md')) scheduleReindex() })
        .on('error', (err) => logger.warn({ err: String(err) }, 'Vault watcher error'))
      logger.info('Vault watcher started for %s', vaultPath)
    },

    async stop() {
      if (watcher) { await watcher.close(); watcher = null }
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
    },
  }
}

export type VaultWatcher = ReturnType<typeof createVaultWatcher>
