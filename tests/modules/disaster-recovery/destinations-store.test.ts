import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('destination store', () => {
  const root = join(tmpdir(), `eyas-dest-${Date.now()}`)
  const prev = process.cwd()

  afterEach(() => {
    process.chdir(prev)
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('persists destinations and primary id', async () => {
    mkdirSync(join(root, 'data', 'backups'), { recursive: true })
    process.chdir(root)
    const {
      loadDestinationStore,
      upsertDestination,
      setPrimaryDestination,
      removeDestination,
    } = await import('@modules/disaster-recovery/destinations/store.js')

    expect(loadDestinationStore().destinations).toEqual([])

    upsertDestination({
      id: 'b2',
      type: 's3',
      name: 'Backblaze',
      enabled: true,
      settings: { endpoint: 'https://s3.example', bucket: 'b' },
      secretRefs: { accessKeyId: 'BACKUP_S3_KEY' },
    })
    let store = loadDestinationStore()
    expect(store.destinations).toHaveLength(1)
    expect(store.destinations[0].name).toBe('Backblaze')

    setPrimaryDestination('b2')
    store = loadDestinationStore()
    expect(store.primaryDestinationId).toBe('b2')
    expect(existsSync(join(root, 'data', 'backups', 'destinations.json'))).toBe(true)

    removeDestination('b2')
    store = loadDestinationStore()
    expect(store.destinations).toHaveLength(0)
    expect(store.primaryDestinationId).toBeNull()
  })
})
