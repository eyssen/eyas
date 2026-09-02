import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('ingress settings store', () => {
  const root = join(tmpdir(), `eyas-ingress-${Date.now()}`)
  const prev = process.cwd()

  afterEach(() => {
    process.chdir(prev)
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('persists hostname without storing a token', async () => {
    mkdirSync(root, { recursive: true })
    process.chdir(root)
    const { loadIngressSettings, saveIngressSettings } = await import(
      '@modules/ingress/settings-store.js'
    )
    expect(loadIngressSettings().hostname).toBe('')
    saveIngressSettings({ hostname: ' eyas.example.com ' })
    expect(loadIngressSettings().hostname).toBe('eyas.example.com')
  })

  it('resolves token from vault when the form is empty', async () => {
    mkdirSync(root, { recursive: true })
    process.chdir(root)
    const { saveIngressSettings, resolveIngressCredentials } = await import(
      '@modules/ingress/settings-store.js'
    )
    saveIngressSettings({ hostname: 'eyas.example.com' })
    const creds = await resolveIngressCredentials(
      {},
      async (key) => (key === 'ingress-cloudflare-token' ? 'vault-token' : null),
    )
    expect(creds).toEqual({ token: 'vault-token', hostname: 'eyas.example.com' })
  })

  it('prefers incoming token and hostname over saved values', async () => {
    mkdirSync(root, { recursive: true })
    process.chdir(root)
    const { saveIngressSettings, resolveIngressCredentials } = await import(
      '@modules/ingress/settings-store.js'
    )
    saveIngressSettings({ hostname: 'old.example.com' })
    const jwt = 'eyJhIjoiZm9ybSIsInQiOiJ4In0.e30.sig'
    const creds = await resolveIngressCredentials(
      { token: jwt, hostname: 'new.example.com' },
      async () => 'vault-token',
    )
    expect(creds).toEqual({ token: jwt, hostname: 'new.example.com' })
  })
})
