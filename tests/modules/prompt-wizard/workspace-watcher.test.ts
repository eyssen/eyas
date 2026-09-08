import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceWatcher } from '../../../src/modules/prompt-wizard/workspace-watcher.js'

describe('workspace-watcher', () => {
  let dataDir: string
  beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'eyas-wsx-')) })
  afterEach(() => { rmSync(dataDir, { recursive: true, force: true }) })

  it('emits invalidate event when a workspace file changes', async () => {
    const id = 'jarvis'
    const root = join(dataDir, 'agents', id)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'AGENTS.md'), 'a')

    const watcher = createWorkspaceWatcher({ dataDir, debounceMs: 50 })
    const events: string[] = []
    watcher.onInvalidate((agentId) => events.push(agentId))
    await watcher.start()
    await new Promise((r) => setTimeout(r, 300)) // let chokidar settle

    writeFileSync(join(root, 'AGENTS.md'), 'b')
    await new Promise((r) => setTimeout(r, 400))

    expect(events).toContain(id)
    await watcher.stop()
  }, 5000)

  it('debounces multiple rapid file changes into a single emit', async () => {
    const id = 'aria'
    const root = join(dataDir, 'agents', id)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'MEMORY.md'), 'v0')

    const watcher = createWorkspaceWatcher({ dataDir, debounceMs: 80 })
    const events: string[] = []
    watcher.onInvalidate((agentId) => events.push(agentId))
    await watcher.start()
    await new Promise((r) => setTimeout(r, 300))

    // Rapid writes within debounce window
    writeFileSync(join(root, 'MEMORY.md'), 'v1')
    writeFileSync(join(root, 'MEMORY.md'), 'v2')
    writeFileSync(join(root, 'MEMORY.md'), 'v3')
    await new Promise((r) => setTimeout(r, 500))

    // Should have been debounced to 1 or a small number (not 3)
    const count = events.filter((e) => e === id).length
    expect(count).toBeGreaterThanOrEqual(1)
    expect(count).toBeLessThan(3)
    await watcher.stop()
  }, 6000)

  it('unsubscribes handler via returned cleanup function', async () => {
    const id = 'hermes'
    const root = join(dataDir, 'agents', id)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'IDENTITY.md'), 'hello')

    const watcher = createWorkspaceWatcher({ dataDir, debounceMs: 50 })
    await watcher.start()
    await new Promise((r) => setTimeout(r, 300)) // let chokidar settle before subscribing

    // Register handler AFTER settle so spurious initial events don't count
    const events: string[] = []
    const unsub = watcher.onInvalidate((agentId) => events.push(agentId))
    unsub() // immediately unsub — subsequent writes should not trigger

    writeFileSync(join(root, 'IDENTITY.md'), 'world')
    await new Promise((r) => setTimeout(r, 400))

    expect(events).toHaveLength(0)
    await watcher.stop()
  }, 5000)

  it('does not emit for .tmp files', async () => {
    const id = 'delphi'
    const root = join(dataDir, 'agents', id)
    mkdirSync(root, { recursive: true })

    const watcher = createWorkspaceWatcher({ dataDir, debounceMs: 50 })
    await watcher.start()
    await new Promise((r) => setTimeout(r, 300)) // settle before subscribing

    // Register handler AFTER settle so no spurious events from dir creation
    const events: string[] = []
    watcher.onInvalidate((agentId) => events.push(agentId))

    writeFileSync(join(root, 'draft.tmp'), 'ignored')
    await new Promise((r) => setTimeout(r, 400))

    expect(events).toHaveLength(0)
    await watcher.stop()
  }, 5000)
})
