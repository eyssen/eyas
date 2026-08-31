import { describe, it, expect } from 'vitest'
import { connectionSecretName } from '@modules/connections/catalog'
import { createOdooClientFromConnection } from '@modules/odoo/connection-client'

describe('createOdooClientFromConnection', () => {
  it('uses the connection-scoped vault secret, not the global odoo-api-key', async () => {
    const asked: string[] = []
    const secrets = {
      async get(name: string) {
        asked.push(name)
        if (name === connectionSecretName('conn-alpha-db', 'api-key')) return 'scoped-key'
        if (name === 'odoo-api-key') return 'global-key'
        return null
      },
    }
    const client = await createOdooClientFromConnection(
      {
        id: 'conn-alpha-db',
        systemType: 'odoo',
        config: { url: 'https://odoo.example.test', db: 'alpha', username: 'bot' },
      },
      secrets,
    )
    expect(client?.configured).toBe(true)
    expect(asked).toContain(connectionSecretName('conn-alpha-db', 'api-key'))
    expect(asked).not.toContain('odoo-api-key')
  })

  it('returns an unconfigured client when the connection is not odoo', async () => {
    const client = await createOdooClientFromConnection(
      { id: 'conn-other', systemType: 'github', config: {} },
      { async get() { return 'x' } },
    )
    expect(client).toBeNull()
  })
})
