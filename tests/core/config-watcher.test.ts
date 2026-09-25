import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createConfigWatcher, type ConfigWatcher } from '@core/config/watcher'
import { createLocalBus } from '@core/bus/local-bus'
import pino from 'pino'

const logger = pino({ level: 'silent' })

function makeTempDir(): string {
  const dir = join(tmpdir(), 'eyas-watcher-test-' + Date.now() + '-' + Math.random().toString(36).slice(2))
  mkdirSync(dir, { recursive: true })
  return dir
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('Config Watcher', () => {
  let tempDir: string
  let watcher: ConfigWatcher | null = null

  afterEach(() => {
    watcher?.close()
    watcher = null
    try { rmSync(tempDir, { recursive: true }) } catch {}
  })

  it('emits eyas.config.reloaded when YAML file changes', async () => {
    tempDir = makeTempDir()
    const bus = createLocalBus()
    const yamlFile = join(tempDir, 'memory.yaml')
    writeFileSync(yamlFile, 'tier: working\n')

    const events: { file: string; data: unknown }[] = []
    bus.on('eyas.config.reloaded', async (data) => {
      events.push(data as { file: string; data: unknown })
    })

    watcher = createConfigWatcher({
      configDir: tempDir,
      debounceMs: 50,
      bus,
      logger,
    })

    // Modify the file
    await wait(100)
    writeFileSync(yamlFile, 'tier: episodic\nretention: 30\n')

    // Wait for debounce + fs event
    await wait(500)

    expect(events.length).toBeGreaterThanOrEqual(1)
    const last = events[events.length - 1]
    expect(last.file).toBe('memory.yaml')
    expect(last.data).toEqual({ tier: 'episodic', retention: 30 })
  })

  it('emits eyas.config.reload.failed for invalid YAML', async () => {
    tempDir = makeTempDir()
    const bus = createLocalBus()
    const yamlFile = join(tempDir, 'bad.yaml')
    writeFileSync(yamlFile, 'valid: true\n')

    const failures: { file: string; reason: string }[] = []
    bus.on('eyas.config.reload.failed', async (data) => {
      failures.push(data as { file: string; reason: string })
    })

    watcher = createConfigWatcher({
      configDir: tempDir,
      debounceMs: 50,
      bus,
      logger,
      validate: (_file, _data) => false, // always fail validation
    })

    await wait(100)
    writeFileSync(yamlFile, 'changed: true\n')
    await wait(500)

    expect(failures.length).toBeGreaterThanOrEqual(1)
    expect(failures[0].file).toBe('bad.yaml')
    expect(failures[0].reason).toBe('validation')
  })

  it('ignores non-YAML files', async () => {
    tempDir = makeTempDir()
    const bus = createLocalBus()

    const events: unknown[] = []
    bus.on('eyas.config.reloaded', async (data) => { events.push(data) })

    watcher = createConfigWatcher({
      configDir: tempDir,
      debounceMs: 50,
      bus,
      logger,
    })

    await wait(100)
    writeFileSync(join(tempDir, 'notes.txt'), 'hello')
    writeFileSync(join(tempDir, 'data.json'), '{}')
    await wait(500)

    expect(events.length).toBe(0)
  })

  it('debounces rapid changes into a single event', async () => {
    tempDir = makeTempDir()
    const bus = createLocalBus()
    const yamlFile = join(tempDir, 'rapid.yaml')
    writeFileSync(yamlFile, 'v: 0\n')

    const events: unknown[] = []
    bus.on('eyas.config.reloaded', async (data) => { events.push(data) })

    watcher = createConfigWatcher({
      configDir: tempDir,
      debounceMs: 200,
      bus,
      logger,
    })

    await wait(100)
    // Rapid writes — only last should trigger
    writeFileSync(yamlFile, 'v: 1\n')
    await wait(30)
    writeFileSync(yamlFile, 'v: 2\n')
    await wait(30)
    writeFileSync(yamlFile, 'v: 3\n')
    await wait(600)

    // Should have exactly 1 event (debounced)
    expect(events.length).toBe(1)
    expect((events[0] as { data: { v: number } }).data.v).toBe(3)
  })

  it('debounces different files independently (no cross-file drop)', async () => {
    tempDir = makeTempDir()
    const bus = createLocalBus()
    const fileA = join(tempDir, 'alpha.yaml')
    const fileB = join(tempDir, 'beta.yaml')
    writeFileSync(fileA, 'v: 0\n')
    writeFileSync(fileB, 'v: 0\n')

    const events: { file: string }[] = []
    bus.on('eyas.config.reloaded', async (data) => {
      events.push(data as { file: string })
    })

    watcher = createConfigWatcher({
      configDir: tempDir,
      debounceMs: 200,
      bus,
      logger,
    })

    await wait(100)
    // Edit two different files within the debounce window — both must reload.
    writeFileSync(fileA, 'v: 1\n')
    await wait(30)
    writeFileSync(fileB, 'v: 1\n')
    await wait(600)

    const files = events.map((e) => e.file)
    expect(files).toContain('alpha.yaml')
    expect(files).toContain('beta.yaml')
  })

  it('handles deleted file gracefully (no crash or unhandled rejection)', async () => {
    tempDir = makeTempDir()
    const bus = createLocalBus()
    const yamlFile = join(tempDir, 'deleted.yaml')
    writeFileSync(yamlFile, 'x: 1\n')

    const failures: unknown[] = []
    bus.on('eyas.config.reload.failed', async (data) => { failures.push(data) })

    watcher = createConfigWatcher({
      configDir: tempDir,
      debounceMs: 50,
      bus,
      logger,
    })

    await wait(100)
    rmSync(yamlFile)
    await wait(500)

    // Deletion must not cause unhandled errors or failure events
    expect(failures.length).toBe(0)
  })
})
