// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Logger } from 'pino'
import type { CliRunner } from '../../cli-runner.js'
import { assertAllowedWrite, MAX_WRITE_CHARS, resolveProjectPath } from '../../path-safety.js'
import type { StudioSettings } from '../../settings-store.js'
import type { StudioEngine, StudioEngineStatus, StudioJob, StudioProject } from '../../types.js'
import { HYPERFRAMES_VERSION_PIN } from '../../types.js'
import { scaffoldComposition, structuralLint } from './scaffold.js'

const RENDER_TIMEOUT_MS = 600_000
const DOCTOR_TIMEOUT_MS = 8_000

export interface HyperframesAdapterDeps {
  runner: CliRunner
  logger: Logger
  getSettings: () => StudioSettings
}

function parseNodeMajor(stdout: string): number | null {
  const m = stdout.trim().match(/^v?(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function createHyperframesAdapter(deps: HyperframesAdapterDeps): StudioEngine {
  const { runner, logger, getSettings } = deps

  async function resolveCli(): Promise<{ command: string; prefixArgs: string[]; path: string | null; viaNpx: boolean }> {
    const settings = getSettings()
    const envBin = process.env.EYAS_HYPERFRAMES_BIN?.trim()
    const configured = settings.hyperframes.cliPath?.trim() || envBin || null
    if (configured && existsSync(configured)) {
      return { command: configured, prefixArgs: [], path: configured, viaNpx: false }
    }
    const onPath = await runner.which('hyperframes')
    if (onPath) {
      return { command: onPath, prefixArgs: [], path: onPath, viaNpx: false }
    }
    const pin = settings.hyperframes.versionPin || HYPERFRAMES_VERSION_PIN
    const npx = await runner.which('npx')
    if (npx && settings.hyperframes.allowNpx) {
      return { command: npx, prefixArgs: ['--yes', `hyperframes@${pin}`], path: null, viaNpx: true }
    }
    return { command: 'hyperframes', prefixArgs: [], path: null, viaNpx: false }
  }

  async function runHf(args: string[], opts: { cwd?: string; timeoutMs?: number; allowNpx?: boolean }) {
    const cli = await resolveCli()
    if (!cli.path && !cli.viaNpx) {
      throw new Error(
        `Hyperframes CLI not found. Install Node.js 22+ and run \`npx hyperframes@${HYPERFRAMES_VERSION_PIN}\`, or set EYAS_HYPERFRAMES_BIN.`,
      )
    }
    if (cli.viaNpx && opts.allowNpx === false) {
      throw new Error(
        `Hyperframes CLI is not on PATH. Install it (\`npm i -g hyperframes@${HYPERFRAMES_VERSION_PIN}\`) or set EYAS_HYPERFRAMES_BIN.`,
      )
    }
    const env: Record<string, string | undefined> = {
      ...process.env,
    }
    // Never hand EYAS's Playwright Chromium to Hyperframes (beginFrame needs chrome-headless-shell).
    delete env.EYAS_CHROMIUM_PATH
    if (process.env.EYAS_HYPERFRAMES_BROWSER) {
      env.PRODUCER_HEADLESS_SHELL_PATH = process.env.EYAS_HYPERFRAMES_BROWSER
    }
    return runner.run(cli.command, [...cli.prefixArgs, ...args], {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      env,
    })
  }

  return {
    id: 'hyperframes',
    name: 'Hyperframes',
    description: 'HTML compositions rendered to deterministic MP4',
    enabled: true,

    async status(): Promise<StudioEngineStatus> {
      const settings = getSettings()
      const checks: StudioEngineStatus['checks'] = []

      const nodeBin = await runner.which('node')
      if (!nodeBin) {
        checks.push({
          id: 'node',
          label: 'Node.js 22+',
          status: 'missing',
          remedy: 'Install Node.js 22 or newer. Hyperframes CLI is not Bun-first.',
        })
      } else {
        const ver = await runner.run(nodeBin, ['-v'], { timeoutMs: DOCTOR_TIMEOUT_MS })
        const major = parseNodeMajor(ver.stdout || ver.stderr)
        if (major != null && major >= 22) {
          checks.push({ id: 'node', label: 'Node.js 22+', status: 'ok', detail: (ver.stdout || ver.stderr).trim() })
        } else {
          checks.push({
            id: 'node',
            label: 'Node.js 22+',
            status: 'missing',
            detail: (ver.stdout || ver.stderr).trim() || 'unknown version',
            remedy: 'Install Node.js 22 or newer.',
          })
        }
      }

      const ffmpeg = await runner.which('ffmpeg')
      if (ffmpeg) {
        checks.push({ id: 'ffmpeg', label: 'FFmpeg', status: 'ok', detail: ffmpeg })
      } else {
        checks.push({
          id: 'ffmpeg',
          label: 'FFmpeg',
          status: 'missing',
          remedy: 'Install FFmpeg (macOS: brew install ffmpeg) and ensure it is on PATH.',
        })
      }

      const cli = await resolveCli()
      if (cli.path) {
        checks.push({ id: 'cli', label: 'Hyperframes CLI', status: 'ok', detail: cli.path })
      } else if (cli.viaNpx && settings.hyperframes.allowNpx) {
        checks.push({
          id: 'cli',
          label: 'Hyperframes CLI',
          status: 'warn',
          detail: `not on PATH; render will use npx hyperframes@${settings.hyperframes.versionPin}`,
          remedy: `Install globally with \`npm i -g hyperframes@${settings.hyperframes.versionPin}\` or set EYAS_HYPERFRAMES_BIN to skip npx on every render.`,
        })
      } else {
        checks.push({
          id: 'cli',
          label: 'Hyperframes CLI',
          status: 'missing',
          remedy: `Install with \`npm i -g hyperframes@${HYPERFRAMES_VERSION_PIN}\` or set EYAS_HYPERFRAMES_BIN.`,
        })
      }

      checks.push({
        id: 'browser',
        label: 'chrome-headless-shell',
        status: process.env.EYAS_HYPERFRAMES_BROWSER && existsSync(process.env.EYAS_HYPERFRAMES_BROWSER)
          ? 'ok'
          : 'warn',
        detail: process.env.EYAS_HYPERFRAMES_BROWSER || 'Hyperframes resolves its own chrome-headless-shell; system Chrome / EYAS Playwright Chromium are not used',
        remedy: 'Run `npx hyperframes browser --install` if a render fails looking for chrome-headless-shell. Never pass --no-sandbox.',
      })

      const available = checks.every((c) => c.status !== 'missing') && settings.hyperframes.enabled
      return {
        engineId: 'hyperframes',
        name: 'Hyperframes',
        enabled: settings.hyperframes.enabled,
        available,
        checks,
      }
    },

    async createProject(input) {
      await mkdir(input.dir, { recursive: true })
      const html = scaffoldComposition(input.title)
      await writeFile(join(input.dir, 'index.html'), html, 'utf8')
    },

    async writeFile(project, relativePath, content) {
      if (content.length > MAX_WRITE_CHARS) {
        throw new Error(`File too large (${content.length} chars, max ${MAX_WRITE_CHARS})`)
      }
      assertAllowedWrite(relativePath)
      const full = resolveProjectPath(project.dir, relativePath)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, content, 'utf8')
      return { path: relativePath, bytes: Buffer.byteLength(content) }
    },

    async lint(project) {
      const htmlPath = join(project.dir, 'index.html')
      let html = ''
      try {
        html = await readFile(htmlPath, 'utf8')
      } catch {
        return {
          ok: false,
          engine: 'structural',
          findings: [{ level: 'error', message: 'index.html is missing' }],
        }
      }
      const structural = structuralLint(html)

      const status = await this.status()
      const cliOk = status.checks.find((c) => c.id === 'cli')?.status !== 'missing'
      if (!cliOk) {
        return {
          ok: structural.every((f) => f.level !== 'error'),
          engine: 'structural',
          findings: structural,
        }
      }

      try {
        const result = await runHf(['lint', '.', '--json'], { cwd: project.dir, timeoutMs: 60_000, allowNpx: true })
        let findings: unknown[] = structural
        const raw = result.stdout.trim()
        if (raw) {
          try {
            const parsed = JSON.parse(raw)
            const extra = Array.isArray(parsed) ? parsed : parsed.findings
            if (Array.isArray(extra)) findings = [...structural, ...extra]
          } catch {
            if (result.code !== 0) {
              findings = [...structural, { level: 'error', message: result.stderr || raw || `lint exited ${result.code}` }]
            }
          }
        } else if (result.code !== 0) {
          findings = [...structural, { level: 'error', message: result.stderr || `lint exited ${result.code}` }]
        }
        const ok = findings.every((f: any) => f?.level !== 'error' && f?.severity !== 'error')
        return { ok, engine: 'hyperframes', findings }
      } catch (err) {
        logger.warn({ err }, 'Hyperframes lint CLI failed; structural lint only')
        return {
          ok: structural.every((f) => f.level !== 'error'),
          engine: 'structural',
          findings: structural,
        }
      }
    },

    async render(project: StudioProject, _job: StudioJob) {
      const status = await this.status()
      const blocking = status.checks.filter((c) => c.status === 'missing')
      if (blocking.length) {
        throw new Error(blocking.map((c) => `${c.label}: ${c.remedy ?? 'missing'}`).join(' '))
      }
      const outputPath = join(project.dir, 'out.mp4')
      const result = await runHf(['render', '-o', outputPath], {
        cwd: project.dir,
        timeoutMs: RENDER_TIMEOUT_MS,
        allowNpx: true,
      })
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || `hyperframes render exited ${result.code}`)
      }
      if (!existsSync(outputPath)) {
        throw new Error('Render reported success but out.mp4 was not written')
      }
      return { outputPath }
    },
  }
}
