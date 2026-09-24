import { defineCommand, runMain } from 'citty'
import { getVersion } from '@core/version.js'

const main = defineCommand({
  meta: {
    name: 'eyas',
    version: getVersion(),
    description: 'EYAS Personal AI Agent Platform',
  },
  subCommands: {
    serve: () => import('./commands/serve.js').then((m) => m.default),
    start: () => import('./commands/start.js').then((m) => m.default),
    stop: () => import('./commands/stop.js').then((m) => m.default),
    restart: () => import('./commands/restart.js').then((m) => m.default),
    update: () => import('./commands/update.js').then((m) => m.default),
    doctor: () => import('./commands/doctor.js').then((m) => m.default),
    status: () => import('./commands/status.js').then((m) => m.default),
    config: () => import('./commands/config.js').then((m) => m.default),
    module: () => import('./commands/module.js').then((m) => m.default),
    migrate: () => import('./commands/migrate.js').then((m) => m.default),
    version: () => import('./commands/version.js').then((m) => m.default),
  },
})

runMain(main)
