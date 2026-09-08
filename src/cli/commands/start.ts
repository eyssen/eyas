// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { defineCommand } from 'citty'
import { openSync } from 'fs'
import { resolve } from 'path'
import { resolveInstance } from '../../core/instance.js'
import { loadResolvedConfig, resolveServerBaseUrl } from '../../core/config/loader.js'
import {
  isProcessRunning,
  readPidFile,
  writePidFile,
  removePidFile,
} from '../utils/process-control.js'
import { probeEyasPort } from '../utils/port-check.js'

export default defineCommand({
  meta: {
    name: 'start',
    description: 'Start EYAS server in the background',
  },
  args: {
    port: { type: 'string', description: 'Server port (overrides config / EYAS_PORT)' },
    host: { type: 'string', description: 'Server host (overrides config / EYAS_HOST)' },
    config: { type: 'string', description: 'Config file path' },
    foreground: {
      type: 'boolean',
      description: 'Run in foreground (same as `eyas serve`)',
      default: false,
    },
  },
  async run({ args }) {
    if (args.port) process.env.EYAS_PORT = args.port
    if (args.host) process.env.EYAS_HOST = args.host

    const instance = resolveInstance({ configPath: args.config })
    const config = loadResolvedConfig({
      configPath: instance.configPath,
      localConfigPath: instance.localConfigPath,
      instance,
    })

    const existing = readPidFile(instance.pidFile)
    if (existing && isProcessRunning(existing)) {
      console.error(`EYAS is already running (PID ${existing}, pidfile ${instance.pidFile})`)
      console.error(`  Use: eyas restart   (or: eyas stop && eyas start)`)
      console.error(`  Or:  eyas status`)
      process.exitCode = 1
      return
    }
    if (existing) {
      // Stale pidfile
      removePidFile(instance.pidFile)
    }

    // Refuse to start if the port is already owned by something else
    const listenPort = args.port ? parseInt(args.port, 10) : config.server.port
    const listenHost = args.host ?? config.server.host
    const probe = await probeEyasPort(listenHost, listenPort)
    if (probe.status === 'eyas') {
      console.error(`EYAS is already responding on port ${listenPort} (${probe.baseUrl})`)
      console.error(`  Use: eyas status / eyas stop`)
      process.exitCode = 1
      return
    }
    if (probe.status === 'foreign') {
      console.error(`Port ${listenPort} is already in use by a non-EYAS service`)
      console.error(`  ${probe.hint}`)
      console.error(`  Pick another port:  EYAS_PORT=3200 ./bin/eyas start`)
      console.error(`  Or free the port (on this machine :3000 is often Grafana).`)
      process.exitCode = 1
      return
    }

    // Production UI is static files under src/web/dist — build automatically if missing
    // so `eyas start` never leaves the user with API-only mode by accident.
    {
      const { ensureWebDist } = await import('../utils/ensure-web-dist.js')
      const web = await ensureWebDist({ installRoot: instance.installRoot, verbose: true })
      if (!web.webDistDir) {
        console.error(web.message)
        console.error('Server not started — fix the frontend build, then retry.')
        process.exitCode = 1
        return
      }
    }

    // Docs at /docs — soft-fail if missing (serve still works without it).
    {
      const { ensureDocsDist } = await import('../utils/ensure-docs-dist.js')
      await ensureDocsDist({ installRoot: instance.installRoot, verbose: true })
    }

    if (args.foreground) {
      const serve = await import('./serve.js')
      // Re-invoke serve command handler with the same flags
      await serve.default.run?.({
        args: {
          port: args.port,
          host: args.host,
          config: args.config ?? instance.configPath,
          _: [],
        },
        rawArgs: [],
        cmd: serve.default,
        data: undefined,
      } as any)
      return
    }

    // Build child argv: same runtime, CLI entry, `serve`
    const entry = resolve(process.argv[1]!)
    const childArgs = [entry, 'serve']
    if (args.port) {
      childArgs.push('--port', args.port)
    } else if (process.env.EYAS_PORT) {
      // keep env inheritance
    } else {
      // ensure resolved port is explicit so child matches parent resolution
      childArgs.push('--port', String(config.server.port))
    }
    if (args.host) childArgs.push('--host', args.host)
    if (args.config) childArgs.push('--config', args.config)
    else if (instance.configPath) childArgs.push('--config', instance.configPath)

    const logPath = instance.logFile
    const logFd = openSync(logPath, 'a')

    const child = Bun.spawn([process.execPath, ...childArgs], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        EYAS_HOME: process.env.EYAS_HOME ?? instance.home,
        EYAS_INSTALL_ROOT: process.env.EYAS_INSTALL_ROOT ?? instance.installRoot,
        ...(args.port ? { EYAS_PORT: args.port } : {}),
        ...(args.host ? { EYAS_HOST: args.host } : {}),
      },
      stdout: logFd,
      stderr: logFd,
      stdin: 'ignore',
    })

    // Detach from parent lifetime
    child.unref()

    if (!child.pid) {
      console.error('Failed to start EYAS — no PID returned')
      process.exitCode = 1
      return
    }

    writePidFile(instance.pidFile, child.pid)

    // Brief wait to catch immediate crash
    await Bun.sleep(800)
    if (!isProcessRunning(child.pid)) {
      removePidFile(instance.pidFile)
      console.error(`EYAS failed to start — see log: ${logPath}`)
      process.exitCode = 1
      return
    }

    const port = args.port ? parseInt(args.port, 10) : config.server.port
    const base = resolveServerBaseUrl({
      server: { ...config.server, port: Number.isFinite(port) ? port : config.server.port },
    })

    console.log(`EYAS started (PID ${child.pid})`)
    console.log(`  URL:     ${base}`)
    console.log(`  Home:    ${instance.home}`)
    console.log(`  Pidfile: ${instance.pidFile}`)
    console.log(`  Log:     ${logPath}`)
    console.log(`  Stop:    eyas stop`)
  },
})
