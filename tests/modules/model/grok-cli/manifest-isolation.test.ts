// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A6 — loading the Grok provider seeds its isolation status with the same
// preflight a turn runs (`grok inspect --json`, no model call), so an
// install whose Grok is isolated offers it for background work from boot,
// and one that is not never does.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearExecutableCache } from '@modules/model/cli-runtime/executables.js'
import { getIsolationStatus, resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import { clearAcpPreflightCache } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { grokCliManifest } from '@modules/model/submodules/grok-cli/manifest.js'
import type { ModuleContext } from '@core/types'

const FIXTURES = join(__dirname, '..', '..', '..', 'fixtures', 'cli', 'grok', '1.0.40')
const KEYS = ['EYAS_GROK_BIN', 'EYAS_DATA_DIR'] as const
const saved: Record<string, string | undefined> = {}
let root: string

/** A grok that answers --version, and `inspect --json` with the given recorded report. */
function fakeGrok(report: 'isolated' | 'hostile'): string {
  const homes = join(root, 'data', 'cli-homes')
  const reportPath = join(root, `inspect-${report}.json`)
  writeFileSync(reportPath, readFileSync(join(FIXTURES, `inspect-${report}.json`), 'utf8')
    .replaceAll('<EYAS_HOMES>', homes)
    .replaceAll('<HOME>', join(root, 'host-home'))
    .replaceAll('<PROJECT>', join(root, 'project'))
    .replaceAll('<ROOT>/workspaces/conv-1', join(root, 'project')))
  const path = join(root, `grok-${report}`)
  writeFileSync(path, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "grok 1.0.40"; exit 0; fi',
    `if [ "$1" = "inspect" ]; then cat '${reportPath}'; exit 0; fi`,
    'exit 1',
  ].join('\n') + '\n')
  chmodSync(path, 0o755)
  return path
}

function ctx() {
  const registered: any[] = []
  const noop = () => {}
  const logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger } as any
  const context = {
    logger,
    config: { server: { host: '127.0.0.1', port: 3999 } },
    providerReload: new Map(),
    providerConfig: {
      ensureProvider: noop,
      getProvider: () => ({ enabled: true, settings: {} }),
      listModels: () => [{ id: 'grok-cli-default' }],
      upsertModels: noop,
    },
    model: {
      registerProvider: (p: any) => registered.push(p),
      unregisterProvider: noop,
      getProvider: () => registered[0],
    },
  } as unknown as ModuleContext
  return { context, registered }
}

async function settled(): Promise<void> {
  for (let i = 0; i < 100 && getIsolationStatus('grok-cli').status === 'unverified'; i++) {
    await new Promise((r) => setTimeout(r, 20))
  }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-manifest-iso-')))
  for (const k of KEYS) saved[k] = process.env[k]
  process.env.EYAS_DATA_DIR = join(root, 'data')
  clearExecutableCache()
  clearAcpPreflightCache()
  resetIsolationStatuses()
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  clearExecutableCache()
  clearAcpPreflightCache()
  resetIsolationStatuses()
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('grok submodule — isolation status at load', () => {
  it('an isolated Grok is verified at load and offered for isolated work (positive)', async () => {
    process.env.EYAS_GROK_BIN = fakeGrok('isolated')
    const { context, registered } = ctx()
    await grokCliManifest.onStart!(context)
    await settled()
    expect(getIsolationStatus('grok-cli')).toMatchObject({ status: 'verified', runtime: { version: '1.0.40', source: 'override' } })
    expect(registered[0].supportsIsolatedCompletion).toBe(true)
  })

  it('a Grok that would load host config is recorded as a violation and never offered (negative)', async () => {
    process.env.EYAS_GROK_BIN = fakeGrok('hostile')
    const { context, registered } = ctx()
    await grokCliManifest.onStart!(context)
    await settled()
    expect(getIsolationStatus('grok-cli').status).toBe('violation')
    expect(registered[0].supportsIsolatedCompletion).toBe(false)
  })
})
