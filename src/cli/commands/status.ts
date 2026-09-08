// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { defineCommand } from 'citty'
import { resolveInstance } from '../../core/instance.js'
import { loadResolvedConfig, resolveServerBaseUrl } from '../../core/config/loader.js'
import { isProcessRunning, readPidFile } from '../utils/process-control.js'
import { probeEyasPort } from '../utils/port-check.js'
import { DEFAULT_SERVER_PORT } from '../../core/config/defaults.js'

export default defineCommand({
  meta: {
    name: 'status',
    description: 'Query running EYAS server status',
  },
  args: {
    url: { type: 'string', description: 'Server base URL (default: from config / EYAS_PORT)' },
    config: { type: 'string', description: 'Config file path' },
  },
  async run({ args }) {
    const instance = resolveInstance({ configPath: args.config, ensureDirs: false })

    let host = '127.0.0.1'
    let port = DEFAULT_SERVER_PORT
    let baseUrl: string | undefined = args.url

    try {
      const config = loadResolvedConfig({
        configPath: instance.configPath,
        localConfigPath: instance.localConfigPath,
        instance,
      })
      host = config.server.host
      port = config.server.port
      if (!baseUrl) baseUrl = resolveServerBaseUrl(config)
    } catch {
      if (!baseUrl) baseUrl = `http://127.0.0.1:${DEFAULT_SERVER_PORT}`
    }

    // Prefer explicit URL host/port for probe when --url given
    if (args.url) {
      try {
        const u = new URL(args.url)
        host = u.hostname
        port = u.port ? parseInt(u.port, 10) : port
        baseUrl = args.url.replace(/\/$/, '')
      } catch {
        // keep resolved
      }
    }

    console.log('\n\x1b[1mEYAS Server Status\x1b[0m\n')
    console.log(`  Home:     ${instance.home}`)
    console.log(`  Config:   ${instance.configPath}`)
    if (instance.localConfigPath) {
      console.log(`  Overlay:  ${instance.localConfigPath}`)
    }
    console.log(`  Expected: ${baseUrl}  (from config/env; default port ${DEFAULT_SERVER_PORT})`)

    const pid = readPidFile(instance.pidFile)
    if (pid) {
      const alive = isProcessRunning(pid)
      console.log(`  Pidfile:  ${instance.pidFile}`)
      console.log(`  PID:      ${pid} ${alive ? '(running)' : '(stale — process not found)'}`)
    } else {
      console.log(`  Pidfile:  (none at ${instance.pidFile})`)
    }

    const probe = await probeEyasPort(host, port)

    if (probe.status === 'eyas') {
      console.log(`  Status:   \x1b[32mok\x1b[0m`)
      console.log(`  Version:  ${probe.version ?? 'unknown'}`)
      console.log(`  URL:      ${probe.baseUrl}`)
      console.log('')
      return
    }

    if (probe.status === 'foreign') {
      console.error(`\n  \x1b[31mPort ${port} is in use by a non-EYAS service\x1b[0m`)
      console.error(`  Probed:   ${probe.baseUrl}/api/v1/health`)
      console.error(`  Response: ${probe.hint}`)
      console.error('')
      console.error('  Fix:')
      console.error(`    • Free the port, or point EYAS elsewhere:`)
      console.error(`        EYAS_PORT=3100 ./bin/eyas start`)
      console.error(`        # or config/local.yaml → server.port: 3100`)
      console.error(`    • Common clash: Grafana/TeslaMate often bind :3000`)
      console.error('')
      process.exitCode = 1
      return
    }

    if (probe.status === 'free') {
      console.error(`\n  \x1b[33mNo server listening on ${baseUrl}\x1b[0m`)
      console.error('  Start with:  ./bin/eyas start   or   ./bin/eyas serve')
      console.error('')
      process.exitCode = 1
      return
    }

    console.error(`\n  \x1b[31mProbe failed:\x1b[0m ${probe.message}\n`)
    process.exitCode = 1
  },
})
