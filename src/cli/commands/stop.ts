// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { defineCommand } from 'citty'
import { resolveInstance } from '../../core/instance.js'
import {
  isProcessRunning,
  readPidFile,
  removePidFile,
  stopProcess,
} from '../utils/process-control.js'

export default defineCommand({
  meta: {
    name: 'stop',
    description: 'Stop a background EYAS server started with `eyas start`',
  },
  args: {
    config: { type: 'string', description: 'Config file path (used to resolve instance home)' },
    force: {
      type: 'boolean',
      description: 'Send SIGKILL immediately after SIGTERM timeout',
      default: false,
    },
  },
  async run({ args }) {
    const instance = resolveInstance({ configPath: args.config, ensureDirs: false })
    const pid = readPidFile(instance.pidFile)

    if (!pid) {
      console.log(`No pidfile at ${instance.pidFile} — nothing to stop.`)
      return
    }

    if (!isProcessRunning(pid)) {
      removePidFile(instance.pidFile)
      console.log(`Stale pidfile removed (PID ${pid} not running).`)
      return
    }

    console.log(`Stopping EYAS (PID ${pid})...`)
    const ok = await stopProcess(pid, args.force ? 1_000 : 10_000)
    removePidFile(instance.pidFile)

    if (ok) {
      console.log('EYAS stopped.')
    } else {
      console.error(`Failed to stop PID ${pid}. Try: kill -9 ${pid}`)
      process.exitCode = 1
    }
  },
})
