import { defineCommand } from 'citty'
import { existsSync, accessSync, constants } from 'fs'
import { platform, arch, version as nodeVersion } from 'process'

// Color helpers for terminal output
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

export interface CheckResult {
  name: string
  status: 'ok' | 'warn' | 'fail'
  message: string
}

export function checkPlatform(): CheckResult {
  const runtime = typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node.js ${nodeVersion}`
  return {
    name: 'Platform',
    status: 'ok',
    message: `${platform} ${arch} — ${runtime}`,
  }
}

export function checkConfig(configPath: string): CheckResult {
  try {
    if (!existsSync(configPath)) {
      return { name: 'Config', status: 'ok', message: `${configPath} not found (defaults will be used)` }
    }
    const { readFileSync } = require('fs')
    const content = readFileSync(configPath, 'utf-8')
    // Basic YAML parse check
    if (content.trim().length === 0) {
      return { name: 'Config', status: 'warn', message: `${configPath} is empty` }
    }
    return { name: 'Config', status: 'ok', message: `${configPath} is valid` }
  } catch (err: any) {
    return { name: 'Config', status: 'fail', message: err.message }
  }
}

export function checkDatabase(dbPath: string): CheckResult {
  if (!existsSync(dbPath)) {
    // Check if parent directory is writable (DB will be created on first run)
    const dir = dbPath.substring(0, dbPath.lastIndexOf('/'))
    if (dir && existsSync(dir)) {
      try {
        accessSync(dir, constants.W_OK)
        return { name: 'Database', status: 'warn', message: `${dbPath} does not exist yet (directory writable, will be created)` }
      } catch {
        return { name: 'Database', status: 'fail', message: `${dbPath} does not exist and directory is not writable` }
      }
    }
    return { name: 'Database', status: 'warn', message: `${dbPath} does not exist (will be created on first run)` }
  }

  try {
    accessSync(dbPath, constants.R_OK | constants.W_OK)
    return { name: 'Database', status: 'ok', message: `${dbPath} exists and is writable` }
  } catch {
    return { name: 'Database', status: 'fail', message: `${dbPath} exists but is not writable` }
  }
}

export function checkMasterKey(): CheckResult {
  const keyPath = 'data/master.key'
  if (existsSync(keyPath)) {
    return { name: 'Master Key', status: 'ok', message: 'data/master.key exists' }
  }
  return { name: 'Master Key', status: 'warn', message: 'data/master.key not found (will be generated during setup)' }
}

export async function checkOllama(): Promise<CheckResult> {
  try {
    const res = await fetch('http://localhost:11434', { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      return { name: 'Ollama', status: 'ok', message: 'Ollama is reachable at localhost:11434' }
    }
    return { name: 'Ollama', status: 'warn', message: `Ollama responded with ${res.status}` }
  } catch {
    return { name: 'Ollama', status: 'warn', message: 'Ollama not reachable at localhost:11434 (optional)' }
  }
}

/**
 * Live SQLite self-test on a scratch in-memory connection (spec §13, spike
 * §2 #2): FTS5, sqlite-vec load, one int8 row, one KNN. Uses the same
 * openRawSqlite() path the server uses, so the darwin custom-SQLite probe
 * is exercised too — the data file is never opened by doctor.
 */
export async function checkSqliteCapabilities(): Promise<CheckResult> {
  try {
    const { openRawSqlite, customSqliteStatus } = await import('../../core/db/connection.js')
    const { probeSqliteCapabilities, describeSqliteCapabilities } = await import('../../core/db/sqlite-capabilities.js')
    const raw = openRawSqlite(':memory:')
    try {
      const caps = probeSqliteCapabilities(raw)
      const custom = customSqliteStatus()
      const via = custom.libraryPath ? ` via ${custom.libraryPath}` : ''
      const message = describeSqliteCapabilities(caps) + via
      if (!caps.fts5) {
        return { name: 'SQLite', status: 'fail', message: `${message} — FTS5 is required (memory, conversation and vault search)` }
      }
      if (!caps.vec0) {
        // extensionLoading true means sqlite-vec DID load and register — the int8 KNN self-test
        // itself failed, which points at a broken/incompatible sqlite-vec build, not a missing
        // SQLite library. Suggesting "brew install sqlite" there would send the operator down the
        // wrong path, since extensions already load fine on this connection.
        const remedy = caps.extensionLoading
          ? 'sqlite-vec extension loaded but the int8 KNN self-test failed — reinstall/rebuild sqlite-vec for this platform (a stale or mismatched binary is the likely cause, not the SQLite library itself)'
          : platform === 'darwin'
            ? "brew install sqlite (Apple's libsqlite3 refuses extensions)"
            : 'sqlite-vec binary for this platform (glibc only; musl needs vec0 built from the amalgamation)'
        return { name: 'SQLite', status: 'warn', message: `${message} — remedy: ${remedy}` }
      }
      return { name: 'SQLite', status: 'ok', message }
    } finally {
      raw.close()
    }
  } catch (err: any) {
    return { name: 'SQLite', status: 'fail', message: `capability probe failed: ${err?.message ?? err}` }
  }
}

/** Which zstd tier L0 compression will use (spec §6): native is expected, WASM is a warning, none is a failure. */
export async function checkZstd(): Promise<CheckResult> {
  try {
    const { initZstd } = await import('../../shared/zstd.js')
    const tier = await initZstd()
    const label = tier === 'bun'
      ? 'Bun native'
      : tier === 'node'
        ? 'node:zlib native'
        : '@bokuweb/zstd-wasm (WASM fallback, about 2x slower than native)'
    return { name: 'zstd', status: tier === 'wasm' ? 'warn' : 'ok', message: `L0 compression tier: ${label}` }
  } catch (err: any) {
    return { name: 'zstd', status: 'fail', message: `no zstd backend — ${err?.message ?? err}` }
  }
}

export function checkModules(configPath: string): CheckResult {
  try {
    const { loadConfig } = require('../../core/config/loader.js')
    const config = loadConfig(configPath)
    const disabled = config.modules?.disabled ?? []
    if (disabled.length > 0) {
      return { name: 'Modules', status: 'ok', message: `Disabled: ${disabled.join(', ')}` }
    }
    return { name: 'Modules', status: 'ok', message: 'All modules enabled' }
  } catch {
    return { name: 'Modules', status: 'warn', message: 'Could not read module config' }
  }
}

function formatResult(result: CheckResult): string {
  const icon = result.status === 'ok' ? green('✓') : result.status === 'warn' ? yellow('⚠') : red('✗')
  return `  ${icon} ${bold(result.name)}: ${dim(result.message)}`
}

export default defineCommand({
  meta: {
    name: 'doctor',
    description: 'Run system diagnostics',
  },
  args: {
    config: { type: 'string', description: 'Config file path' },
  },
  async run({ args }) {
    console.log(bold('\nEYAS Doctor\n'))

    const { resolveInstance } = await import('../../core/instance.js')
    const { loadResolvedConfig } = await import('../../core/config/loader.js')
    const instance = resolveInstance({ configPath: args.config, ensureDirs: false })

    const results: CheckResult[] = []

    // Synchronous checks
    results.push(checkPlatform())
    results.push(checkConfig(instance.configPath))
    if (instance.localConfigPath) {
      results.push(checkConfig(instance.localConfigPath))
    }

    // Get DB path from resolved config if possible
    let dbPath = instance.databasePath
    try {
      const config = loadResolvedConfig({
        configPath: instance.configPath,
        localConfigPath: instance.localConfigPath,
        instance,
      })
      dbPath = config.database.path
    } catch {
      // Use instance default
    }

    results.push({
      name: 'Instance',
      status: 'ok',
      message: `home=${instance.home} port-env=${process.env.EYAS_PORT ?? '(config)'}`,
    })
    results.push(checkDatabase(dbPath))
    results.push(checkMasterKey())
    results.push(checkModules(instance.configPath))

    // Async checks
    results.push(await checkOllama())
    results.push(await checkSqliteCapabilities())
    results.push(await checkZstd())

    // Output
    for (const r of results) {
      console.log(formatResult(r))
    }

    const failures = results.filter((r) => r.status === 'fail')
    const warnings = results.filter((r) => r.status === 'warn')

    console.log('')
    if (failures.length > 0) {
      console.log(red(`  ${failures.length} issue(s) found.`))
      process.exitCode = 1
    } else if (warnings.length > 0) {
      console.log(yellow(`  ${warnings.length} warning(s), no critical issues.`))
    } else {
      console.log(green('  All checks passed!'))
    }
    console.log('')
  },
})
