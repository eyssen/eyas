// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { defineCommand } from 'citty'
import { getVersion } from '@core/version.js'
import { createUpdateService } from '../../modules/system-update/update-service.js'
import { createLocalBackupProvider } from '../../modules/disaster-recovery/providers/local.js'
import { createBackupService } from '../../modules/disaster-recovery/backup-service.js'
import { createLogger } from '../../core/logger.js'

function makeService() {
  const logger = createLogger({ level: 'info', pretty: true })
  const backup = createBackupService(createLocalBackupProvider())
  return createUpdateService({ logger, backup })
}

const check = defineCommand({
  meta: {
    name: 'check',
    description: 'Check GitHub (eyssen/eyas) for a newer version',
  },
  async run() {
    const svc = makeService()
    const r = await svc.check()
    console.log(`\nCurrent:  ${r.currentVersion}`)
    console.log(`Latest:   ${r.latestVersion ?? 'unknown'}`)
    console.log(`Update:   ${r.updateAvailable ? 'YES' : 'no'}`)
    console.log(`Install:  ${r.installMethod} @ ${r.installRoot}`)
    console.log(`Backup:   ${r.backupReady ? `ready (${r.backupCount} existing)` : 'NOT READY'}`)
    console.log(`Can apply:${r.canApply ? ' yes' : ' no'}`)
    if (r.blockReasons.length) {
      console.log('\nBlockers:')
      for (const b of r.blockReasons) console.log(`  - ${b}`)
    }
    if (r.latest) {
      console.log(`\nRelease:  ${r.latest.htmlUrl}`)
      console.log(`Source:   ${r.latest.source}`)
      if (r.latest.body) {
        console.log('\n--- notes ---\n')
        console.log(r.latest.body.slice(0, 3000))
        if (r.latest.body.length > 3000) console.log('\n…')
      }
    }
    console.log('')
    if (r.updateAvailable && r.canApply) {
      console.log('Apply with:  eyas update apply')
    } else if (r.updateAvailable && !r.backupReady) {
      console.log('Create a backup first (Backup UI or POST /api/v1/backup/create), then: eyas update apply')
    }
    console.log('')
  },
})

const apply = defineCommand({
  meta: {
    name: 'apply',
    description: 'Backup, pull/checkout new version, rebuild, restart (git installs only)',
  },
  args: {
    target: { type: 'string', description: 'Tag or ref (default: latest from GitHub)' },
    force: {
      type: 'boolean',
      description: 'Allow dirty working tree / reinstall same version',
      default: false,
    },
    yes: {
      type: 'boolean',
      description: 'Skip confirmation prompt',
      default: false,
    },
  },
  async run({ args }) {
    const svc = makeService()
    const status = await svc.check()
    console.log(`\nCurrent ${status.currentVersion} → target ${args.target ?? status.latestVersion ?? '?'}`)
    if (!status.backupReady) {
      console.error('\nBackup is mandatory. Enable disaster-recovery and create a backup first.\n')
      process.exitCode = 1
      return
    }
    if (!args.yes) {
      console.log('\nThis will: create a fresh backup, git checkout the target, bun install, build:web, restart.')
      console.log('Pass --yes to confirm.\n')
      process.exitCode = 1
      return
    }
    const result = await svc.apply({ target: args.target, force: args.force })
    for (const s of result.steps) console.log(`  • ${s}`)
    console.log('')
    if (result.ok) {
      console.log(result.message)
      if (result.backupId) console.log(`Backup id: ${result.backupId}`)
    } else {
      console.error(result.message)
      process.exitCode = 1
    }
    console.log('')
  },
})

export default defineCommand({
  meta: {
    name: 'update',
    description: 'Check for / apply EYAS updates from GitHub',
  },
  subCommands: {
    check,
    apply,
  },
  run() {
    console.log(`\nEYAS v${getVersion()}`)
    console.log('Usage:')
    console.log('  eyas update check          # see if a newer version exists')
    console.log('  eyas update apply --yes    # backup + upgrade + restart\n')
  },
})
