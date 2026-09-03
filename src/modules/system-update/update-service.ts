// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Logger } from 'pino'
import { getVersion } from '@core/version.js'
import { detectInstallRoot } from '@core/instance.js'
import { installNestedPackage } from '../../../scripts/install-nested-package'
import type { BackupService } from '@modules/disaster-recovery/backup-service.js'
import {
  DEFAULT_GITHUB_REPO,
  fetchChangelogForRef,
  fetchRemoteReleases,
  type RemoteRelease,
} from './github.js'
import { isNewerVersion, normalizeVersion } from './version-compare.js'

export type InstallMethod = 'git' | 'docker' | 'unknown'

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  latest: RemoteRelease | null
  releases: RemoteRelease[]
  installMethod: InstallMethod
  installRoot: string
  repo: string
  backupReady: boolean
  backupCount: number
  canApply: boolean
  blockReasons: string[]
  checkedAt: string
}

export interface UpdateApplyResult {
  ok: boolean
  message: string
  backupId?: string
  targetVersion?: string
  steps: string[]
  restartScheduled?: boolean
}

export interface UpdateService {
  check(): Promise<UpdateCheckResult>
  apply(opts?: { target?: string; force?: boolean }): Promise<UpdateApplyResult>
}

function detectInstallMethod(installRoot: string): InstallMethod {
  if (existsSync('/.dockerenv') || process.env.EYAS_INSTALL_METHOD === 'docker') {
    return 'docker'
  }
  if (existsSync(join(installRoot, '.git'))) return 'git'
  return 'unknown'
}

async function run(
  cmd: string[],
  cwd: string,
  logger: Logger,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) {
    logger.warn({ cmd, code, stderr: stderr.slice(0, 500) }, 'update command failed')
  }
  return { code, stdout, stderr }
}

export function createUpdateService(opts: {
  logger: Logger
  backup?: BackupService | null
  repo?: string
}): UpdateService {
  const logger = opts.logger
  const repo = opts.repo ?? process.env.EYAS_GITHUB_REPO ?? DEFAULT_GITHUB_REPO

  async function check(): Promise<UpdateCheckResult> {
    const installRoot = detectInstallRoot()
    const installMethod = detectInstallMethod(installRoot)
    const currentVersion = getVersion()
    const blockReasons: string[] = []

    let backupCount = 0
    let backupReady = false
    if (opts.backup) {
      try {
        const list = await opts.backup.listBackups()
        backupCount = list.length
        backupReady = true
      } catch (err) {
        backupReady = false
        blockReasons.push(
          `Backup service error: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    } else {
      blockReasons.push('Disaster-recovery / backup module is not available')
    }

    if (installMethod === 'docker') {
      blockReasons.push(
        'Docker install: self-update via git is disabled — use docker compose pull && docker compose up -d --build',
      )
    } else if (installMethod === 'unknown') {
      blockReasons.push('Not a git checkout — cannot auto-update (reinstall or convert to git clone)')
    }

    const releases = await fetchRemoteReleases(repo)
    // Prefer newest by tag order from API (GitHub returns newest first for tags/releases)
    let latest: RemoteRelease | null = releases[0] ?? null

    // If tags are not sorted, pick max by compare
    for (const r of releases) {
      if (!latest || isNewerVersion(r.tag, latest.tag)) latest = r
    }

    const latestVersion = latest ? normalizeVersion(latest.tag) : null
    const updateAvailable = !!(
      latestVersion && isNewerVersion(latestVersion, currentVersion)
    )

    // Enrich body if empty
    if (latest && (!latest.body || latest.body.length < 20)) {
      const cl = await fetchChangelogForRef(repo, latest.tag)
      if (cl) latest = { ...latest, body: cl }
    }

    // Self-apply only for git checkouts with a working backup module.
    // A fresh backup is always created at apply time (even if backupCount is 0).
    if (!updateAvailable) {
      /* no extra blocker */
    } else if (!backupReady) {
      if (!blockReasons.some((b) => /backup/i.test(b))) {
        blockReasons.push('Backup must be available — open Backup settings and ensure disaster-recovery works')
      }
    } else if (installMethod !== 'git') {
      /* already pushed install-method blockers above */
    }

    const canApply =
      updateAvailable && backupReady && installMethod === 'git'

    return {
      currentVersion,
      latestVersion,
      updateAvailable,
      latest,
      releases: releases.slice(0, 10),
      installMethod,
      installRoot,
      repo,
      backupReady,
      backupCount,
      canApply,
      blockReasons,
      checkedAt: new Date().toISOString(),
    }
  }

  async function apply(applyOpts: { target?: string; force?: boolean } = {}): Promise<UpdateApplyResult> {
    const steps: string[] = []
    const status = await check()
    const installRoot = status.installRoot

    if (status.installMethod !== 'git') {
      return {
        ok: false,
        message:
          status.installMethod === 'docker'
            ? 'Docker installs cannot self-update via this button. Run: docker compose pull && docker compose up -d --build'
            : 'Install root is not a git repository — update manually or reinstall from GitHub.',
        steps,
      }
    }

    if (!status.backupReady || !opts.backup) {
      return {
        ok: false,
        message:
          'Backup is required before self-update. Configure / open Backup, create a backup once, then retry. Disaster-recovery module must be enabled.',
        steps,
      }
    }

    const targetTag =
      applyOpts.target
      ?? (status.latest?.tag ?? null)

    if (!targetTag) {
      return { ok: false, message: 'No target version found on GitHub.', steps }
    }

    if (!applyOpts.force && !isNewerVersion(targetTag, status.currentVersion)) {
      return {
        ok: false,
        message: `Already on ${status.currentVersion} (target ${targetTag} is not newer). Use force to reinstall.`,
        steps,
      }
    }

    // 1) Fresh backup (mandatory)
    steps.push('Creating pre-update backup…')
    let backupId: string | undefined
    try {
      const meta = await opts.backup.createBackup()
      backupId = meta.id
      steps.push(`Backup created: ${meta.filename ?? meta.id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        message: `Pre-update backup failed — aborting update: ${msg}`,
        steps,
      }
    }

    // 2) Ensure clean-ish git tree for tracked files (allow dirty with force)
    steps.push('Checking git status…')
    const st = await run(['git', 'status', '--porcelain'], installRoot, logger)
    if (st.code === 0 && st.stdout.trim() && !applyOpts.force) {
      return {
        ok: false,
        message:
          'Working tree has local changes. Commit/stash them, or pass force=true to update anyway (risky).',
        steps: [...steps, st.stdout.trim().slice(0, 400)],
        backupId,
      }
    }

    // 3) Fetch + checkout tag/branch
    steps.push(`Fetching origin…`)
    const fetch = await run(['git', 'fetch', '--tags', '--force', 'origin'], installRoot, logger)
    if (fetch.code !== 0) {
      return {
        ok: false,
        message: `git fetch failed: ${fetch.stderr || fetch.stdout}`,
        steps,
        backupId,
      }
    }

    steps.push(`Checking out ${targetTag}…`)
    // Try tag first, then origin/main if target is main
    let co = await run(['git', 'checkout', '--force', targetTag], installRoot, logger)
    if (co.code !== 0) {
      co = await run(['git', 'checkout', '--force', `tags/${targetTag}`], installRoot, logger)
    }
    if (co.code !== 0 && targetTag === 'main') {
      co = await run(['git', 'checkout', '--force', 'main'], installRoot, logger)
      if (co.code === 0) {
        await run(['git', 'pull', '--ff-only', 'origin', 'main'], installRoot, logger)
      }
    }
    if (co.code !== 0) {
      return {
        ok: false,
        message: `git checkout ${targetTag} failed: ${co.stderr || co.stdout}`,
        steps,
        backupId,
      }
    }
    steps.push(`Checked out ${targetTag}`)

    // 4) Dependencies + frontend
    steps.push('bun install…')
    const install = await run(['bun', 'install'], installRoot, logger)
    if (install.code !== 0) {
      return {
        ok: false,
        message: `bun install failed: ${install.stderr || install.stdout}`,
        steps,
        backupId,
        targetVersion: targetTag,
      }
    }
    steps.push('bun install OK')

    const webDir = join(installRoot, 'src', 'web')
    if (existsSync(join(webDir, 'package.json'))) {
      steps.push('frontend deps (src/web)…')
      const webInstall = await installNestedPackage(webDir, {
        skipIfReady: ['vite', '@vitejs/plugin-react'],
      })
      if (!webInstall.ok) {
        return {
          ok: false,
          message: `src/web bun install failed: ${webInstall.message}`,
          steps,
          backupId,
          targetVersion: targetTag,
        }
      }
      steps.push(webInstall.skippedLinks.length ? webInstall.message : 'frontend deps OK')
    }

    steps.push('bun run build:web…')
    const build = await run(['bun', 'run', 'build:web'], installRoot, logger)
    if (build.code !== 0) {
      return {
        ok: false,
        message: `build:web failed: ${build.stderr || build.stdout}`,
        steps,
        backupId,
        targetVersion: targetTag,
      }
    }
    steps.push('Frontend build OK')

    // Docs is optional — soft-fail so UI updates are not blocked
    steps.push('bun run docs:build…')
    const docsBuild = await run(['bun', 'run', 'docs:build'], installRoot, logger)
    if (docsBuild.code !== 0) {
      steps.push(`Docs build skipped/failed: ${(docsBuild.stderr || docsBuild.stdout || '').slice(0, 200)}`)
    } else {
      steps.push('Docs build OK')
    }

    // 5) Schedule restart (detached) so HTTP can finish
    const pid = process.pid
    const startBin = existsSync(join(installRoot, 'bin', 'eyas'))
      ? join(installRoot, 'bin', 'eyas')
      : null

    if (startBin) {
      const script = `
set -e
sleep 2
kill -TERM ${pid} 2>/dev/null || true
sleep 2
kill -KILL ${pid} 2>/dev/null || true
cd ${JSON.stringify(installRoot)}
export EYAS_INSTALL_ROOT=${JSON.stringify(installRoot)}
${JSON.stringify(process.execPath)} ${JSON.stringify(startBin)} start || true
`.trim()
      Bun.spawn(['bash', '-c', script], {
        cwd: installRoot,
        stdout: 'ignore',
        stderr: 'ignore',
        stdin: 'ignore',
      }).unref()
      steps.push('Restart scheduled (server will come back on the same port)')
    } else {
      steps.push('No bin/eyas found — restart manually: eyas restart')
    }

    // Read new version if version.json updated
    let newVer = targetTag
    try {
      const vj = JSON.parse(readFileSync(join(installRoot, 'version.json'), 'utf-8')) as {
        version?: string
      }
      if (vj.version) newVer = vj.version
    } catch {
      /* ignore */
    }

    return {
      ok: true,
      message: `Updated toward ${newVer}. Server restarting…`,
      backupId,
      targetVersion: newVer,
      steps,
      restartScheduled: !!startBin,
    }
  }

  return { check, apply }
}
