// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K2 — the folders the system prompt names are the ones the run really
// uses: a stored folder a protection rule now refuses (the agent runner
// leaves it out with a notice) is not named to the model either. A folder
// that is only missing is still named, as before. Throw-away layout only.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveWorkingDirectoriesContextImpl } from '@modules/prompt-wizard/context-resolvers.js'
import { installPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture.js'

let f: SovereigntyFixture
let project: string

const ctxWith = (workingDirectories: unknown) => ({ conversations: { get: () => ({ workingDirectories }) }, logger: { debug: vi.fn() } })

beforeEach(() => {
  f = createSovereigntyFixture()
  installPathPolicy(f.policy)
  vi.stubEnv('HOME', f.home)
  project = join(f.root, 'projects', 'app')
  mkdirSync(project, { recursive: true })
})
afterEach(() => {
  resetPathPolicyForTests()
  vi.unstubAllEnvs()
  f.cleanup()
})

describe('resolveWorkingDirectoriesContextImpl (K2)', () => {
  it('(−) a refused stored folder is not named; the next allowed one is the primary', async () => {
    const documents = join(f.home, 'Documents')
    mkdirSync(join(documents, 'Vault', '.obsidian'), { recursive: true })
    const out = await resolveWorkingDirectoriesContextImpl(ctxWith([f.repo, project, documents]), 'conv-1')
    expect(out).toEqual({ primary: project, extra: [] })
  })

  it('(−) every stored folder refused: no folder is named', async () => {
    expect(await resolveWorkingDirectoriesContextImpl(ctxWith([f.repo]), 'conv-1')).toEqual({ primary: null, extra: [] })
  })

  it('(+) allowed folders — and a missing one — are named as stored', async () => {
    const missing = join(f.root, 'gone')
    expect(await resolveWorkingDirectoriesContextImpl(ctxWith(JSON.stringify([project, missing])), 'conv-1'))
      .toEqual({ primary: project, extra: [missing] })
  })
})
