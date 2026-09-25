// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { ToolImplementation, ToolResult } from '@modules/tools/types.js'
import type { CliRunner } from '@modules/studio/cli-runner.js'
import {
  agentBrowserSpawnEnv,
  doctorAgentBrowser,
  prepareAgentBrowserRun,
  resolveAgentBrowserCli,
  resolveDataDir,
} from '@shared/agent-browser.js'
import { normalizeBrowserUseSettings, type BrowserUseSettings } from './settings-store.js'
import { doctorBrowserUse, resolveBrowserUseCli, telemetryOffEnv } from './doctor.js'

const NOT_READY = { error: 'Browser Use module not ready yet — try again shortly' }
const EXEC_TIMEOUT_MS = 180_000
const MAX_CODE_CHARS = 20_000
const MAX_ARGV_CHARS = 20_000

function errorOf(err: unknown): ToolResult {
  return { error: err instanceof Error ? err.message : String(err) }
}

const runValidator = z.object({
  argv: z.array(z.string().min(1).max(4_000)).max(64).optional(),
  batch: z.array(z.array(z.string().min(1).max(4_000)).min(1).max(32)).max(32).optional(),
}).superRefine((val, ctx) => {
  const hasArgv = Array.isArray(val.argv)
  const hasBatch = Array.isArray(val.batch)
  if (hasArgv === hasBatch) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Pass exactly one of argv or batch' })
  }
  const joined = hasArgv
    ? (val.argv ?? []).join(' ')
    : (val.batch ?? []).map((row) => row.join(' ')).join('\n')
  if (joined.length > MAX_ARGV_CHARS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `command payload exceeds ${MAX_ARGV_CHARS} characters` })
  }
})

export function createBrowserUseTools(deps: {
  getRunner: () => CliRunner | undefined
  getSettings: () => BrowserUseSettings
  getDataDir?: () => string
}): ToolImplementation[] {
  const dataDirOf = () => deps.getDataDir?.() ?? resolveDataDir()

  return [
    {
      name: 'browser_use_status',
      description:
        'Check whether the Browser Use CLI sidecar can drive a real Chrome via CDP. Missing Python/CLI return a remedy. Headless Playwright tools (browser_*) do not need this. Prefer agent_browser_status when that doctor is Ready.',
      category: 'browser',
      riskTier: 'green',
      inputSchema: { type: 'object', properties: {} },
      validator: z.object({}).passthrough(),
      execute: async () => {
        const runner = deps.getRunner()
        if (!runner) return NOT_READY
        try {
          return await doctorBrowserUse(runner, deps.getSettings(), { dataDir: dataDirOf() }) as unknown as ToolResult
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'browser_use_exec',
      description:
        'Run Python against the Browser Use CLI 3.0 (piped on stdin) to control the user\'s real Chrome via CDP. Helpers: new_tab(url), goto_url(url), page_info(), click_at_xy(x,y), type_text(text), fill_input(selector, text), js(code), capture_screenshot(). Not for LLM calls — EYAS already has a model. Prefer agent_browser_run (or browser_* for public pages) when that sidecar is Ready. Call browser_use_status first.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      timeoutMs: EXEC_TIMEOUT_MS + 5_000,
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Python using Browser Use CLI helpers, piped to the CLI stdin',
          },
        },
        required: ['code'],
      },
      validator: z.object({ code: z.string().min(1).max(MAX_CODE_CHARS) }),
      execute: async (input) => {
        const runner = deps.getRunner()
        if (!runner) return NOT_READY
        const settings = normalizeBrowserUseSettings(deps.getSettings())
        if (!settings.enabled) {
          return { error: 'Browser Use is disabled in settings.' }
        }
        try {
          const status = await doctorBrowserUse(runner, settings, { dataDir: dataDirOf() })
          if (!status.available) {
            const missing = status.checks.filter((c) => c.status === 'missing')
            return {
              error: 'Browser Use CLI is not ready',
              checks: status.checks,
              remedy: missing.map((c) => c.remedy).filter(Boolean).join(' '),
            }
          }
          const cli = await resolveBrowserUseCli(runner, settings)
          const result = await runner.run(cli.command, cli.prefixArgs, {
            input: String(input.code),
            timeoutMs: EXEC_TIMEOUT_MS,
            env: telemetryOffEnv(settings.allowCloud),
          })
          return {
            code: result.code,
            stdout: result.stdout.slice(0, 20_000),
            stderr: result.stderr.slice(0, 8_000),
          }
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'agent_browser_status',
      description:
        'Check the optional Vercel agent-browser CLI (Apache-2.0). Missing binary returns a remedy. Does not need Python. Prefer this sidecar over browser_use_exec when Ready. Headless browser_* do not need this. Never agent-browser chat — EYAS owns the model.',
      category: 'browser',
      riskTier: 'green',
      inputSchema: { type: 'object', properties: {} },
      validator: z.object({}).passthrough(),
      execute: async () => {
        const runner = deps.getRunner()
        if (!runner) return NOT_READY
        try {
          const settings = normalizeBrowserUseSettings(deps.getSettings())
          return await doctorAgentBrowser(runner, settings.agentBrowser, { dataDir: dataDirOf() }) as unknown as ToolResult
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'agent_browser_run',
      description:
        'Run the Vercel agent-browser CLI (argv or batch JSON). Snapshot refs are @e1. Use state save/load for auth. EYAS-owned --profile, never the daily Chrome profile. Not chat, not an LLM SDK. Call agent_browser_status first. Prefer this over browser_use_exec when Ready. Public pages: browser_*.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      timeoutMs: EXEC_TIMEOUT_MS + 5_000,
      inputSchema: {
        type: 'object',
        properties: {
          argv: {
            type: 'array',
            items: { type: 'string' },
            description: 'CLI args after the binary, e.g. ["snapshot","-i"] or ["click","@e1"]',
          },
          batch: {
            type: 'array',
            items: { type: 'array', items: { type: 'string' } },
            description: 'JSON batch rows piped to `agent-browser batch --json`',
          },
        },
      },
      validator: runValidator,
      execute: async (input, ctx) => {
        const runner = deps.getRunner()
        if (!runner) return NOT_READY
        const settings = normalizeBrowserUseSettings(deps.getSettings())
        if (!settings.agentBrowser.enabled) {
          return { error: 'agent-browser sidecar is disabled in settings.' }
        }
        const dataDir = dataDirOf()
        try {
          const status = await doctorAgentBrowser(runner, settings.agentBrowser, { dataDir })
          if (!status.available) {
            const missing = status.checks.filter((c) => c.status === 'missing')
            return {
              error: 'agent-browser CLI is not ready',
              checks: status.checks,
              remedy: missing.map((c) => c.remedy).filter(Boolean).join(' '),
            }
          }
          const prepared = prepareAgentBrowserRun({
            argv: Array.isArray(input.argv) ? input.argv : undefined,
            batch: Array.isArray(input.batch) ? input.batch : undefined,
            dataDir,
            allowedDomains: settings.agentBrowser.allowedDomains,
            workspaceRoots: [
              ...(ctx?.workingDirectories ?? []),
              ...(ctx?.workingDirectory ? [ctx.workingDirectory] : []),
            ].filter(Boolean),
          })
          const cli = await resolveAgentBrowserCli({ runner, cliPath: settings.agentBrowser.cliPath })
          if (cli.kind !== 'found') {
            return { error: 'agent-browser CLI is not ready', remedy: status.checks.find((c) => c.id === 'cli')?.remedy }
          }
          const result = await runner.run(cli.command, prepared.args, {
            input: prepared.stdin,
            timeoutMs: EXEC_TIMEOUT_MS,
            env: agentBrowserSpawnEnv({ dataDir, allowedDomains: settings.agentBrowser.allowedDomains }),
          })
          return {
            code: result.code,
            stdout: result.stdout.slice(0, 20_000),
            stderr: result.stderr.slice(0, 8_000),
          }
        } catch (err) {
          return errorOf(err)
        }
      },
    },
  ]
}
