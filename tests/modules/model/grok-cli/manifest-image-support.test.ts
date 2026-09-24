// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H6 — the Grok/Kimi submodules write what the CLI reports it accepts in a
// prompt into the model catalog: a turn whose initialize advertises no image
// input turns the provider's Vision flag off, one that does turns it on.
// Driven end to end: the manifest's own provider, the real ACP runner and the
// fake ACP agent over stdio.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearExecutableCache } from '@modules/model/cli-runtime/executables.js'
import { resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import { grokCliManifest } from '@modules/model/submodules/grok-cli/manifest.js'
import { kimiCliManifest } from '@modules/model/submodules/kimi-cli/manifest.js'
import type { ModuleContext } from '@core/types'
import { FAKE_ACP_AGENT } from '../../../helpers/fake-acp.js'

const KEYS = ['EYAS_GROK_BIN', 'EYAS_KIMI_BIN', 'EYAS_DATA_DIR'] as const
const saved: Record<string, string | undefined> = {}
let root: string

const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`

/** The fake ACP agent behind a wrapper that also answers --version, as the resolver asks. */
function fakeAgentBin(name: string, promptImage: boolean): string {
  const path = join(root, name)
  const vars = [
    `FAKE_ACP_LOG=${q(join(root, `${name}.log`))}`,
    ...(promptImage ? ['FAKE_ACP_PROMPT_IMAGE=1'] : []),
  ].join(' ')
  writeFileSync(path, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "fake 1.0.40"; exit 0; fi',
    `${vars} exec ${q(process.execPath)} ${q(FAKE_ACP_AGENT)} "$@"`,
  ].join('\n') + '\n')
  chmodSync(path, 0o755)
  return path
}

function context() {
  const registered: any[] = []
  const setImageSupport = vi.fn()
  const noop = () => {}
  const logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger } as any
  const ctx = {
    logger,
    config: { server: { host: '127.0.0.1', port: 3999 } },
    providerReload: new Map(),
    providerConfig: {
      ensureProvider: noop,
      getProvider: () => ({ enabled: true, settings: {} }),
      listModels: () => [{ modelId: 'seeded' }],
      upsertModels: noop,
      setImageSupport,
    },
    model: {
      registerProvider: (p: any) => registered.push(p),
      unregisterProvider: noop,
      getProvider: () => registered[0],
    },
  } as unknown as ModuleContext
  return { ctx, registered, setImageSupport }
}

async function turn(provider: any): Promise<void> {
  const cwd = join(root, 'workspace')
  mkdirSync(cwd, { recursive: true })
  for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { workingDirectory: cwd } })) { /* drain */ }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-image-support-')))
  for (const k of KEYS) saved[k] = process.env[k]
  process.env.EYAS_DATA_DIR = join(root, 'data')
  clearExecutableCache()
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  clearExecutableCache()
  resetIsolationStatuses()
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('Grok/Kimi submodules — the Vision flag follows the CLI', () => {
  it('grok: a CLI that advertises no image input turns the Vision flag off (negative)', async () => {
    process.env.EYAS_GROK_BIN = fakeAgentBin('grok', false)
    const { ctx, registered, setImageSupport } = context()
    await grokCliManifest.onStart!(ctx)
    await turn(registered[0])
    expect(setImageSupport).toHaveBeenCalledWith('grok-cli', false)
    expect(setImageSupport).not.toHaveBeenCalledWith('grok-cli', true)
  })

  it('grok: a CLI that advertises image input turns it on (positive)', async () => {
    process.env.EYAS_GROK_BIN = fakeAgentBin('grok', true)
    const { ctx, registered, setImageSupport } = context()
    await grokCliManifest.onStart!(ctx)
    await turn(registered[0])
    expect(setImageSupport).toHaveBeenCalledWith('grok-cli', true)
  })

  it('kimi: the report lands on the kimi-cli rows only', async () => {
    process.env.EYAS_KIMI_BIN = fakeAgentBin('kimi', true)
    const { ctx, registered, setImageSupport } = context()
    await kimiCliManifest.onStart!(ctx)
    await turn(registered[0])
    expect(setImageSupport).toHaveBeenCalledWith('kimi-cli', true)
    expect(setImageSupport.mock.calls.every(([id]) => id === 'kimi-cli')).toBe(true)
  })
})
