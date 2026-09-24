// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { defineCommand } from 'citty'
import { resolveInstance } from '../../core/instance.js'
import {
  isProcessRunning,
  readPidFile,
  removePidFile,
  stopProcess,
} from '../utils/process-control.js'
import { probeEyasPort } from '../utils/port-check.js'
import { loadResolvedConfig } from '../../core/config/loader.js'

/**
 * Stop a background instance (if running), wait for the port to free, then start again.
 * Passes through the same --port / --host / --config flags as `eyas start`.
 */
export default defineCommand({
  meta: {
    name: 'restart',
    description: 'Restart a background EYAS server (stop then start)',
  },
  args: {
    port: { type: 'string', description: 'Server port after restart (overrides config / EYAS_PORT)' },
    host: { type: 'string', description: 'Server host after restart (overrides config / EYAS_HOST)' },
    config: { type: 'string', description: 'Config file path' },
    force: {
      type: 'boolean',
      description: 'Faster stop (shorter SIGTERM wait before SIGKILL)',
      default: false,
    },
  },
  async run({ args }) {
    if (args.port) process.env.EYAS_PORT = args.port
    if (args.host) process.env.EYAS_HOST = args.host

    const instance = resolveInstance({ configPath: args.config, ensureDirs: false })
    const pid = readPidFile(instance.pidFile)

    if (pid && isProcessRunning(pid)) {
      console.log(`Stopping EYAS (PID ${pid})...`)
      const ok = await stopProcess(pid, args.force ? 1_000 : 10_000)
      removePidFile(instance.pidFile)
      if (!ok) {
        console.error(`Failed to stop PID ${pid}. Try: kill -9 ${pid} && eyas start`)
        process.exitCode = 1
        return
      }
      console.log('EYAS stopped.')
    } else if (pid) {
      removePidFile(instance.pidFile)
      console.log(`Stale pidfile removed (PID ${pid} not running).`)
    } else {
      console.log('No running background server — starting fresh.')
    }

    // Wait briefly for the listen port to be free (avoid "port in use" race)
    try {
      const config = loadResolvedConfig({
        configPath: instance.configPath,
        localConfigPath: instance.localConfigPath,
        instance,
      })
      const port = args.port ? parseInt(args.port, 10) : config.server.port
      const host = args.host ?? config.server.host
      const deadline = Date.now() + 8_000
      while (Date.now() < deadline) {
        const probe = await probeEyasPort(host, port, 400)
        if (probe.status === 'free') break
        // Foreign process on the port — start will refuse with a clear error
        if (probe.status === 'foreign') break
        await Bun.sleep(200)
      }
    } catch {
      await Bun.sleep(500)
    }

    console.log('Starting EYAS...')
    const start = await import('./start.js')
    await start.default.run?.({
      args: {
        port: args.port,
        host: args.host,
        config: args.config,
        foreground: false,
        _: [],
      },
      rawArgs: [],
      cmd: start.default,
      data: undefined,
    } as any)
  },
})
