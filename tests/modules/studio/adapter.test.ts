// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { createHyperframesAdapter } from '@modules/studio/submodules/hyperframes/adapter'
import { defaultStudioSettings } from '@modules/studio/settings-store'
import type { CliRunner, CliRunResult } from '@modules/studio/cli-runner'
import type { StudioProject } from '@modules/studio/types'

function fakeProject(dir: string): StudioProject {
  const ts = new Date().toISOString()
  return {
    id: 'p1',
    engineId: 'hyperframes',
    title: 'Demo',
    dir,
    conversationId: 'c1',
    createdAt: ts,
    updatedAt: ts,
  }
}

describe('hyperframes adapter', () => {
  let root: string
  const bins = new Map<string, string>()
  const runs: Array<{ command: string; args: string[] }> = []

  const runner: CliRunner = {
    async which(bin) {
      return bins.get(bin) ?? null
    },
    async run(command, args): Promise<CliRunResult> {
      runs.push({ command, args })
      if (args.includes('--no-sandbox')) {
        throw new Error('sandbox flag leaked to the runner')
      }
      if (command === '/usr/bin/node' && args[0] === '-v') {
        return { code: 0, stdout: 'v22.14.0\n', stderr: '' }
      }
      if (args.includes('lint')) {
        return { code: 0, stdout: '{"findings":[]}', stderr: '' }
      }
      if (args.includes('render')) {
        const out = args[args.indexOf('-o') + 1]
        writeFileSync(out, 'mp4')
        return { code: 0, stdout: 'ok', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hf-adapter-'))
    bins.clear()
    runs.length = 0
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('status is fail-closed with remedies when node/ffmpeg/cli are missing', async () => {
    const adapter = createHyperframesAdapter({
      runner,
      logger: pino({ enabled: false }),
      getSettings: defaultStudioSettings,
    })
    const status = await adapter.status()
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'node')?.status).toBe('missing')
    expect(status.checks.find((c) => c.id === 'ffmpeg')?.remedy).toMatch(/ffmpeg/i)
    expect(status.checks.find((c) => c.id === 'cli')?.remedy).toMatch(/hyperframes/)
  })

  it('renders through the CLI argv array and never passes --no-sandbox', async () => {
    bins.set('node', '/usr/bin/node')
    bins.set('ffmpeg', '/usr/bin/ffmpeg')
    bins.set('hyperframes', '/usr/bin/hyperframes')
    const adapter = createHyperframesAdapter({
      runner,
      logger: pino({ enabled: false }),
      getSettings: defaultStudioSettings,
    })
    const project = fakeProject(root)
    await adapter.createProject({ id: 'p1', title: 'Demo', dir: root })
    const { outputPath } = await adapter.render(project, {
      id: 'j1',
      engineId: 'hyperframes',
      projectId: 'p1',
      kind: 'render',
      status: 'running',
      error: null,
      outputPath: null,
      documentIds: [],
      conversationId: 'c1',
      agentId: null,
      userId: 'u1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    })
    expect(outputPath).toBe(join(root, 'out.mp4'))
    expect(runs.some((r) => r.args.includes('--no-sandbox'))).toBe(false)
    expect(runs.some((r) => r.command === '/usr/bin/hyperframes' && r.args[0] === 'render')).toBe(true)
  })
})
