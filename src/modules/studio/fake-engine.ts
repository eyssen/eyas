// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { StudioEngine, StudioJob, StudioProject } from './types.js'
import { scaffoldComposition } from './submodules/hyperframes/scaffold.js'
import { assertAllowedWrite, resolveProjectPath } from './path-safety.js'

export function createFakeStudioEngine(over?: Partial<StudioEngine> & { id?: string }): StudioEngine {
  const id = over?.id ?? 'fake'
  const base: StudioEngine = {
    id,
    name: over?.name ?? 'Fake Studio',
    description: over?.description ?? 'Test engine',
    enabled: over?.enabled ?? true,
    async status() {
      return {
        engineId: id,
        name: base.name,
        enabled: base.enabled,
        available: true,
        checks: [{ id: 'ok', label: 'ok', status: 'ok' }],
      }
    },
    async createProject(input) {
      await mkdir(input.dir, { recursive: true })
      await writeFile(join(input.dir, 'index.html'), scaffoldComposition(input.title), 'utf8')
    },
    async writeFile(project: StudioProject, relativePath: string, content: string) {
      assertAllowedWrite(relativePath)
      const full = resolveProjectPath(project.dir, relativePath)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, content, 'utf8')
      return { path: relativePath, bytes: Buffer.byteLength(content) }
    },
    async lint() {
      return { ok: true, engine: id, findings: [] }
    },
    async render(project: StudioProject, _job: StudioJob) {
      const outputPath = join(project.dir, 'out.mp4')
      await writeFile(outputPath, 'fake-mp4')
      return { outputPath }
    },
  }
  return { ...base, ...over, id }
}
