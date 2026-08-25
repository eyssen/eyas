// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { defineCommand } from 'citty'
import type { WSData } from '../../core/http/ws-server.js'
import {
  resolveDocsDistDir,
  resolveWebDistDir,
  resolveInstance,
} from '../../core/instance.js'
import { writePidFile, removePidFile } from '../utils/process-control.js'
import { tryServeDocs, tryServeWebSpa } from '../utils/static-files.js'

export interface ServerBinding {
  host: string
  port: number
}

/**
 * Resolve the effective host/port for the HTTP server.
 *
 * Priority (highest first):
 *   CLI --port/--host → already applied into config via env in bootstrap when
 *   set on the process; CLI flags here are the final override.
 *
 * When a flag is omitted the value comes from the resolved config
 * (default.yaml + local.yaml + EYAS_PORT/EYAS_HOST).
 */
export function resolveServerBinding(
  args: { port?: string; host?: string },
  config: { server: { host: string; port: number } },
): ServerBinding {
  return {
    host: args.host ?? config.server.host,
    port: args.port ? parseInt(args.port, 10) : config.server.port,
  }
}

export default defineCommand({
  meta: {
    name: 'serve',
    description: 'Start EYAS server (foreground)',
  },
  args: {
    port: { type: 'string', description: 'Server port (overrides config / EYAS_PORT)' },
    host: { type: 'string', description: 'Server host (overrides config / EYAS_HOST)' },
    config: { type: 'string', description: 'Config file path' },
  },
  async run({ args }) {
    // Propagate CLI overrides into env before bootstrap so loadResolvedConfig sees them
    if (args.port) process.env.EYAS_PORT = args.port
    if (args.host) process.env.EYAS_HOST = args.host

    // Early port clash check + ensure frontend/docs builds (before full bootstrap)
    const { resolveInstance } = await import('../../core/instance.js')
    const { loadResolvedConfig } = await import('../../core/config/loader.js')
    const { probeEyasPort } = await import('../utils/port-check.js')
    const { ensureWebDist } = await import('../utils/ensure-web-dist.js')
    const { ensureDocsDist } = await import('../utils/ensure-docs-dist.js')
    const inst = resolveInstance({ configPath: args.config, ensureDirs: false })
    const cfg = loadResolvedConfig({
      configPath: inst.configPath,
      localConfigPath: inst.localConfigPath,
      instance: inst,
    })
    const bind = resolveServerBinding(args, cfg)
    const probe = await probeEyasPort(bind.host, bind.port)
    if (probe.status === 'eyas') {
      console.error(`EYAS already running on port ${bind.port} (${probe.baseUrl})`)
      process.exitCode = 1
      return
    }
    if (probe.status === 'foreign') {
      console.error(`Port ${bind.port} is in use by a non-EYAS service: ${probe.hint}`)
      console.error(`  Try: ./bin/eyas serve --port 3200`)
      process.exitCode = 1
      return
    }

    const webEnsure = await ensureWebDist({ installRoot: inst.installRoot, verbose: true })
    if (!webEnsure.webDistDir) {
      console.error(webEnsure.message)
      console.error('Refusing to start without a frontend build.')
      process.exitCode = 1
      return
    }

    const docsEnsure = await ensureDocsDist({ installRoot: inst.installRoot, verbose: true })

    const { bootstrap } = await import('../../core/bootstrap.js')
    const ctx = await bootstrap({ configPath: args.config })

    const { host, port } = resolveServerBinding(args, ctx.config)

    const instance = resolveInstance({ configPath: args.config, ensureDirs: false })
    const webDistDir = resolveWebDistDir(instance.installRoot) ?? webEnsure.webDistDir
    const hasWebDist = webDistDir !== null
    if (hasWebDist) {
      ctx.logger.info(`Serving frontend from ${webDistDir}`)
    }

    const docsDistDir = resolveDocsDistDir(instance.installRoot) ?? docsEnsure.docsDistDir
    if (docsDistDir) {
      ctx.logger.info(`Serving docs from ${docsDistDir} at /docs/`)
    } else {
      ctx.logger.warn(`${docsEnsure.message} — /docs unavailable`)
    }

    const { setupWsServer, startAgentPostBoot } = await import('../../core/http/ws-server.js')
    const { shutdown } = await import('../../core/bootstrap.js')

    const wsServer = await setupWsServer(ctx)

    const server = Bun.serve<WSData>({
      fetch(req, server) {
        const url = new URL(req.url)

        if (url.pathname === '/ws') {
          return wsServer.handleUpgrade(req, server)
        }

        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/')) {
          return ctx.http.fetch(req)
        }

        // Docs BEFORE SPA so React index.html does not swallow /docs/*
        if (docsDistDir) {
          const docsRes = tryServeDocs(url.pathname, docsDistDir)
          if (docsRes) return docsRes
        }

        if (hasWebDist && webDistDir) {
          return tryServeWebSpa(url.pathname, webDistDir)
        }

        return ctx.http.fetch(req)
      },

      websocket: wsServer.websocket,

      hostname: host,
      port,
      idleTimeout: 120,
    })

    ctx.logger.info(`Server listening on http://${server.hostname}:${server.port}`)
    ctx.logger.info(`Instance home: ${instance.home}`)
    if (docsDistDir) {
      ctx.logger.info(`Docs: http://${server.hostname}:${server.port}/docs/`)
    }

    // Write pidfile when started in foreground too (stop can find us if home matches)
    writePidFile(instance.pidFile, process.pid)

    startAgentPostBoot(ctx)

    const graceful = async () => {
      ctx.logger.info('Shutting down...')
      removePidFile(instance.pidFile)
      wsServer.destroy()
      server.stop()
      await shutdown()
      process.exit(0)
    }

    process.on('SIGINT', graceful)
    process.on('SIGTERM', graceful)
  },
})
