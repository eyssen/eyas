import { defineCommand } from 'citty'
import { apiGet } from '../utils/api-client.js'

const list = defineCommand({
  meta: {
    name: 'list',
    description: 'List all modules and their status',
  },
  args: {
    url: { type: 'string', description: 'Server base URL (default: from config / EYAS_PORT)' },
    config: { type: 'string', description: 'Config file path' },
  },
  async run({ args }) {
    console.log('\n\x1b[1mEYAS Modules\x1b[0m\n')

    // Try to get from running server first
    try {
      const modules = await apiGet('/api/v1/modules', args.url || undefined)
      if (Array.isArray(modules)) {
        for (const mod of modules) {
          const icon = mod.enabled ? '\x1b[32m●\x1b[0m' : '\x1b[2m○\x1b[0m'
          console.log(`  ${icon} ${mod.id}${mod.description ? ` — ${mod.description}` : ''}`)
        }
      } else {
        console.log(`  ${JSON.stringify(modules, null, 2)}`)
      }
      console.log('')
      return
    } catch {
      // Server not running — fall back to config
    }

    // Offline: read disabled modules from resolved config
    try {
      const { resolveInstance } = await import('../../core/instance.js')
      const { loadResolvedConfig } = await import('../../core/config/loader.js')
      const instance = resolveInstance({ configPath: args.config, ensureDirs: false })
      const config = loadResolvedConfig({
        configPath: instance.configPath,
        localConfigPath: instance.localConfigPath,
        instance,
      })
      const disabled = config.modules?.disabled ?? []
      if (disabled.length > 0) {
        console.log('  \x1b[2mServer not running. Disabled modules from config:\x1b[0m')
        for (const mod of disabled) {
          console.log(`  \x1b[2m○\x1b[0m ${mod}`)
        }
      } else {
        console.log('  \x1b[2mServer not running. No modules disabled in config.\x1b[0m')
      }
    } catch (err: any) {
      console.error(`  \x1b[31mFailed to read config:\x1b[0m ${err.message}`)
    }
    console.log('')
  },
})

const enable = defineCommand({
  meta: {
    name: 'enable',
    description: 'Enable a module',
  },
  args: {
    name: { type: 'positional', description: 'Module ID to enable', required: true },
    url: { type: 'string', description: 'Server base URL (default: from config / EYAS_PORT)' },
  },
  async run({ args }) {
    try {
      const result = await apiGet(`/api/v1/modules/${args.name}/enable`, args.url || undefined)
      console.log(`\n\x1b[32m✓\x1b[0m Module ${args.name} enabled: ${result.message ?? 'OK'}\n`)
    } catch (err: any) {
      console.error(`\n\x1b[31m✗\x1b[0m Failed to enable module: ${err.message}\n`)
      process.exitCode = 1
    }
  },
})

const disable = defineCommand({
  meta: {
    name: 'disable',
    description: 'Disable a module',
  },
  args: {
    name: { type: 'positional', description: 'Module ID to disable', required: true },
    url: { type: 'string', description: 'Server base URL (default: from config / EYAS_PORT)' },
  },
  async run({ args }) {
    try {
      const result = await apiGet(`/api/v1/modules/${args.name}/disable`, args.url || undefined)
      console.log(`\n\x1b[32m✓\x1b[0m Module ${args.name} disabled: ${result.message ?? 'OK'}\n`)
    } catch (err: any) {
      console.error(`\n\x1b[31m✗\x1b[0m Failed to disable module: ${err.message}\n`)
      process.exitCode = 1
    }
  },
})

export default defineCommand({
  meta: {
    name: 'module',
    description: 'Manage EYAS modules',
  },
  subCommands: {
    list,
    enable,
    disable,
  },
})
