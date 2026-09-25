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
    // First destination is auto-primary
    expect(store.primaryDestinationId).toBe('b2')

    setPrimaryDestination('b2')
    store = loadDestinationStore()
    expect(store.primaryDestinationId).toBe('b2')
    expect(existsSync(join(root, 'data', 'backups', 'destinations.json'))).toBe(true)

    removeDestination('b2')
    store = loadDestinationStore()
    expect(store.destinations).toHaveLength(0)
    expect(store.primaryDestinationId).toBeNull()
  })

  it('does not replace an existing primary when adding another dest', async () => {
    mkdirSync(join(root, 'data', 'backups'), { recursive: true })
    process.chdir(root)
    const { upsertDestination, loadDestinationStore } = await import(
      '@modules/disaster-recovery/destinations/store.js'
    )
    upsertDestination({
      id: 'b2',
      type: 's3',
      name: 'B2',
      enabled: true,
      settings: {},
      secretRefs: {},
    })
    upsertDestination({
      id: 'ftp1',
      type: 'ftp',
      name: 'FTP',
      enabled: true,
      settings: {},
      secretRefs: {},
    })
    expect(loadDestinationStore().primaryDestinationId).toBe('b2')
  })
})

describe('resolveSecrets', () => {
  afterEach(() => {
    delete process.env.BACKUP_S3_ACCESS_KEY
  })

  it('uses env when the ref is an env var name', async () => {
    process.env.BACKUP_S3_ACCESS_KEY = 'from-env'
    const { resolveSecrets } = await import('@modules/disaster-recovery/destinations/store.js')
    const out = await resolveSecrets({ accessKeyId: 'BACKUP_S3_ACCESS_KEY' })
    expect(out.accessKeyId).toBe('from-env')
  })

  it('uses the secrets vault when env is unset', async () => {
    const { resolveSecrets } = await import('@modules/disaster-recovery/destinations/store.js')
    const out = await resolveSecrets(
      { accessKeyId: 'backup-dest-x-accessKeyId' },
      async (key) => (key === 'backup-dest-x-accessKeyId' ? 'from-vault' : null),
    )
    expect(out.accessKeyId).toBe('from-vault')
  })

  it('treats a pasted credential as the secret when env and vault miss', async () => {
    const { resolveSecrets } = await import('@modules/disaster-recovery/destinations/store.js')
    const out = await resolveSecrets(
      {
        accessKeyId: '0034examplekeyid000000001',
        secretAccessKey: 'K003+not-a-real-secret',
      },
      async () => null,
    )
    expect(out.accessKeyId).toBe('0034examplekeyid000000001')
    expect(out.secretAccessKey).toBe('K003+not-a-real-secret')
  })
})
