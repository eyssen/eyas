import { defineCommand } from 'citty'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { apiPost } from '../utils/api-client.js'

const validate = defineCommand({
  meta: {
    name: 'validate',
    description: 'Validate all config files',
  },
  args: {
    config: { type: 'string', description: 'Config file path' },
  },
  async run({ args }) {
    console.log('\n\x1b[1mConfig Validation\x1b[0m\n')
    let hasErrors = false

    // Validate main config (+ local overlay + env)
    try {
      const { resolveInstance } = await import('../../core/instance.js')
      const { loadResolvedConfig } = await import('../../core/config/loader.js')
      const instance = resolveInstance({ configPath: args.config, ensureDirs: false })
      const cfg = loadResolvedConfig({
        configPath: instance.configPath,
        localConfigPath: instance.localConfigPath,
        instance,
      })
      console.log(`  \x1b[32m✓\x1b[0m ${instance.configPath} (port ${cfg.server.port})`)
      if (instance.localConfigPath) {
        console.log(`  \x1b[32m✓\x1b[0m ${instance.localConfigPath} (merged)`)
      }
    } catch (err: any) {
      console.log(`  \x1b[31m✗\x1b[0m config: ${err.message}`)
      hasErrors = true
    }

    // Validate personality files
    const personalityDir = 'config/personality'
    if (existsSync(personalityDir)) {
      const files = readdirSync(personalityDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      for (const file of files) {
        const filePath = join(personalityDir, file)
        try {
          const { parse: parseYaml } = await import('yaml')
          const raw = readFileSync(filePath, 'utf-8')
          parseYaml(raw) // Just validate YAML syntax
          console.log(`  \x1b[32m✓\x1b[0m ${filePath}`)
        } catch (err: any) {
          console.log(`  \x1b[31m✗\x1b[0m ${filePath}: ${err.message}`)
          hasErrors = true
        }
      }
    }

    console.log('')
    if (hasErrors) {
      console.log('  \x1b[31mValidation failed.\x1b[0m\n')
      process.exitCode = 1
    } else {
      console.log('  \x1b[32mAll config files valid.\x1b[0m\n')
    }
  },
})

const reload = defineCommand({
  meta: {
    name: 'reload',
    description: 'Reload server configuration',
  },
  args: {
    url: { type: 'string', description: 'Server base URL (default: from config / EYAS_PORT)' },
  },
  async run({ args }) {
    try {
      const result = await apiPost('/api/v1/config/reload', undefined, args.url || undefined)
      console.log(`\n\x1b[32m✓\x1b[0m Config reloaded: ${result.message ?? 'OK'}\n`)
    } catch (err: any) {
      console.error(`\n\x1b[31m✗\x1b[0m Failed to reload config: ${err.message}\n`)
      process.exitCode = 1
    }
  },
})

export default defineCommand({
  meta: {
    name: 'config',
    description: 'Validate or reload configuration',
  },
  subCommands: {
    validate,
    reload,
  },
})
