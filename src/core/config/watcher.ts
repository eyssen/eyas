// Config hot-reload — watches config directory for YAML changes
import { watch, type FSWatcher } from 'fs'
import { readFile, access } from 'fs/promises'
import { parse } from 'yaml'
import type { EyasBus } from '@core/types.js'
import type { Logger } from 'pino'

export interface ConfigWatcherOptions {
  configDir: string
  debounceMs?: number
  bus: EyasBus
  logger: Logger
  validate?: (file: string, data: unknown) => boolean
}

export interface ConfigWatcher {
  close(): void
}

export function createConfigWatcher(options: ConfigWatcherOptions): ConfigWatcher {
  const { configDir, debounceMs = 300, bus, logger, validate } = options
  // Per-filename debounce timers so concurrent edits to different files are
  // each debounced independently (a shared timer would drop all but the last).
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let watcher: FSWatcher

  try {
    watcher = watch(configDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return
      if (!filename.endsWith('.yaml') && !filename.endsWith('.yml')) return

      const existing = debounceTimers.get(filename)
      if (existing) clearTimeout(existing)
      debounceTimers.set(filename, setTimeout(async () => {
        debounceTimers.delete(filename)
        const filePath = `${configDir}/${filename}`

        // Skip if file was deleted
        try {
          await access(filePath)
        } catch {
          logger.debug('Config file removed, ignoring: %s', filename)
          return
        }

        try {
          const content = await readFile(filePath, 'utf-8')
          const data = parse(content)

          if (validate && !validate(filename, data)) {
            logger.warn('Config validation failed for %s — keeping old config', filename)
            bus.emit('eyas.config.reload.failed', { file: filename, reason: 'validation' })
            return
          }

          logger.info('Config reloaded: %s', filename)
          bus.emit('eyas.config.reloaded', { file: filename, data })
        } catch (err) {
          logger.warn('Config reload error for %s: %s', filename, (err as Error).message)
          bus.emit('eyas.config.reload.failed', { file: filename, reason: (err as Error).message })
        }
      }, debounceMs))
    })
  } catch (err) {
    logger.warn('Failed to start config watcher on %s: %s', configDir, (err as Error).message)
    return { close() {} }
  }

  logger.info('Config watcher started on %s', configDir)

  return {
    close() {
      watcher.close()
      for (const timer of debounceTimers.values()) clearTimeout(timer)
      debounceTimers.clear()
    },
  }
}
