// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// `eyas doctor` warns when skills.importRoots / agent.importRoots point into
// another tool's own folders — the server skips those roots on start. Temp
// dirs only; the operator's real home is never read.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkImportRoots } from '../../src/cli/commands/doctor'
import { createPathPolicy, workAreaRootsOf, type PathPolicy } from '../../src/shared/memory-sovereignty/path-policy'

let root: string
let home: string
let policy: PathPolicy

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-doctor-import-roots-'))
  home = join(root, 'home')
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true })
  mkdirSync(join(home, '.grok', 'skills'), { recursive: true })
  const dataDir = join(root, 'data')
  policy = createPathPolicy({
    homeDir: home,
    env: {},
    dataDir,
    workspacesRoot: join(dataDir, 'workspaces'),
    workAreaRoots: workAreaRootsOf({ dataDir, workspacesDir: join(dataDir, 'workspaces') }),
    providerHomes: [join(dataDir, 'cli-homes')],
  })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('checkImportRoots', () => {
  it('is ok when no import roots are configured', async () => {
    expect(await checkImportRoots({}, policy)).toEqual({ name: 'Import roots', status: 'ok', message: 'none configured' })
  })

  it('is ok when every root is an ordinary folder', async () => {
    const result = await checkImportRoots({
      skills: { importRoots: [join(root, 'team-skills')] },
      agent: { importRoots: [join(root, 'team-agents')] },
    }, policy)
    expect(result).toEqual({ name: 'Import roots', status: 'ok', message: '2 root(s) scanned' })
  })

  it('warns on a provider-native root, names the setting and points at Data port', async () => {
    const result = await checkImportRoots({
      skills: { importRoots: [join(root, 'team-skills'), join(home, '.grok', 'skills')] },
      agent: { importRoots: [join(home, '.claude', 'agents')] },
    }, policy)
    expect(result.status).toBe('warn')
    expect(result.message).toContain(`skills.importRoots: ${join(home, '.grok', 'skills')} is inside Grok CLI (~/.grok)`)
    expect(result.message).toContain(`agent.importRoots: ${join(home, '.claude', 'agents')} is inside Claude Code (~/.claude)`)
    expect(result.message).toContain('Data portability')
    expect(result.message).not.toContain('team-skills')
  })
})
