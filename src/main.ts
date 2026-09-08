// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { join } from 'node:path'
import { bootstrap, shutdown } from './core/bootstrap.js'
import { setupWsServer, startAgentPostBoot, type WSData } from './core/http/ws-server.js'
import {
  resolveInstance,
  resolveWebDistDir,
  resolveDocsDistDir,
} from './core/instance.js'
import { writePidFile, removePidFile } from './cli/utils/process-control.js'
import { tryServeDocs, tryServeWebSpa } from './cli/utils/static-files.js'
import { tryServePublicAsset } from './cli/utils/public-assets.js'

/**
 * Docker / compose HEALTHCHECK entry.
 * Usage: bun run dist/main.js --health-check
 * Probes the local HTTP health endpoint (does not bootstrap the full app).
 */
async function healthCheck(): Promise<never> {
  const { DEFAULT_SERVER_PORT } = await import('./core/config/defaults.js')
  const port = process.env.EYAS_PORT
    ? parseInt(process.env.EYAS_PORT, 10)
    : DEFAULT_SERVER_PORT
  const host = process.env.EYAS_HOST && process.env.EYAS_HOST !== '0.0.0.0'
    ? process.env.EYAS_HOST
    : '127.0.0.1'
  const url = `http://${host}:${port}/api/v1/health`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
    if (!res.ok) {
      console.error(`health-check failed: ${res.status} ${url}`)
      process.exit(1)
    }
    process.exit(0)
  } catch (err) {
    console.error(`health-check failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

async function main() {
  if (process.argv.includes('--health-check')) {
    await healthCheck()
    return
  }

  // Build frontend + docs before bootstrap so first-time start gets UI and docs.
  const { ensureWebDist } = await import('./cli/utils/ensure-web-dist.js')
  const { ensureDocsDist } = await import('./cli/utils/ensure-docs-dist.js')
  const preInstance = resolveInstance({ ensureDirs: false })
  const webEnsure = await ensureWebDist({
    installRoot: preInstance.installRoot,
    verbose: true,
  })
  const docsEnsure = await ensureDocsDist({
    installRoot: preInstance.installRoot,
    verbose: true,
  })

  const ctx = await bootstrap()
  const { host, port } = ctx.config.server
  const instance = resolveInstance({ ensureDirs: false })

  // Brand assets live outside Hono so they can be embedded in email and in
  // exported pages — see cli/utils/public-assets.ts.
  const publicAssetDir = join(instance.dataDir, 'public')

  const webDistDir = resolveWebDistDir(instance.installRoot) ?? webEnsure.webDistDir
  const hasWebDist = webDistDir !== null
  if (hasWebDist) {
    ctx.logger.info(`Serving frontend from ${webDistDir}`)
  } else {
    ctx.logger.warn(`${webEnsure.message} — API only`)
  }

  const docsDistDir = resolveDocsDistDir(instance.installRoot) ?? docsEnsure.docsDistDir
  if (docsDistDir) {
    ctx.logger.info(`Serving docs from ${docsDistDir} at /docs/`)
  } else {
    ctx.logger.warn(`${docsEnsure.message} — /docs unavailable`)
  }

  const wsServer = await setupWsServer(ctx)

  const server = Bun.serve<WSData>({
    fetch(req, server) {
      const url = new URL(req.url)

      if (url.pathname === '/api/v1/hand/ws') {
        return wsServer.handleHandUpgrade(req, server)
      }

      if (url.pathname === '/ws') {
        return wsServer.handleUpgrade(req, server)
      }

      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/')) {
        return ctx.http.fetch(req)
      }

      // Must precede tryServeWebSpa, which is an unconditional catch-all.
      const assetRes = tryServePublicAsset(url.pathname, publicAssetDir)
      if (assetRes) return assetRes

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
  writePidFile(instance.pidFile, process.pid)

  startAgentPostBoot(ctx)

  const graceful = async (signal: string) => {
    ctx.logger.info(`Received ${signal}, shutting down...`)
    removePidFile(instance.pidFile)
    wsServer.destroy()
    server.stop()
    await shutdown()
    process.exit(0)
  }

  process.on('SIGINT', () => graceful('SIGINT'))
  process.on('SIGTERM', () => graceful('SIGTERM'))
}

main().catch((err) => {
  console.error('Fatal error during startup:', err)
  process.exit(1)
})
