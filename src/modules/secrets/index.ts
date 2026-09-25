// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { deriveMasterKey, exportKey } from './crypto.js'
import { resolveMasterKey, storeMasterKeyToFile } from './master-key.js'
import { createSecretsRegistry } from './registry.js'
import { createSecretsRoutes } from './routes.js'
import { createSecretsAuditSink } from './audit-sink.js'

let masterKeyRef: CryptoKey | null = null

export function getMasterKey(): CryptoKey | null {
  return masterKeyRef
}

export const secretsModule: EyasModule = {
  id: 'secrets',
  name: 'Secrets',
  version: '1.0.0',
  type: 'core',
  required: true,
  description: 'Encrypted secret storage with scope-based access control',
  dependencies: ['setup'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL,
        encrypted TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        module TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(name, scope)
      )
    `)

    ctx.setup.registerStep({
      id: 'master-password',
      module: 'secrets',
      title: 'Master Password',
      description: 'Set a master password to encrypt all stored secrets',
      required: true,
      order: 5,
      fields: [
        { name: 'masterPassword', type: 'password', label: 'Master Password', required: true },
        { name: 'confirmPassword', type: 'password', label: 'Confirm Password', required: true },
      ],
      async onComplete(data) {
        const password = data.masterPassword as string
        const confirm = data.confirmPassword as string
        if (password !== confirm) {
          throw new Error('Passwords do not match')
        }
        if (password.length < 8) {
          throw new Error('Master password must be at least 8 characters')
        }
        const salt = crypto.getRandomValues(new Uint8Array(16))
        const key = await deriveMasterKey(password, salt)
        const hexKey = await exportKey(key)
        const stored = storeMasterKeyToFile(hexKey)
        if (!stored) {
          ctx.logger.warn('Could not write master key file — provide EYAS_MASTER_KEY env var on restart')
        }
        // Store salt in step data for potential recovery
        ;(data as any).__salt = Buffer.from(salt).toString('base64')
        masterKeyRef = key
        // Initialize real registry now that key is available
        const registry = createSecretsRegistry(ctx.db, key, createSecretsAuditSink(ctx))
        ctx.secrets = registry
        ctx.logger.info('Secrets vault initialized with master key')
      },
    })

    ctx.logger.info('Secrets module registered')
  },

  async onStart(ctx: ModuleContext) {
    if (!masterKeyRef) {
      const result = await resolveMasterKey()
      if (result) {
        masterKeyRef = result.key
        ctx.logger.info(`Master key loaded from ${result.source}`)
      } else if (ctx.setup.isComplete()) {
        ctx.logger.error('FATAL: Setup complete but no master key found. Provide EYAS_MASTER_KEY env var.')
      }
    }

    if (masterKeyRef) {
      const registry = createSecretsRegistry(ctx.db, masterKeyRef, createSecretsAuditSink(ctx))
      ctx.secrets = registry
      ctx.logger.info('Secrets module started with encryption enabled')
    } else {
      ctx.logger.warn('Secrets module started without encryption — complete setup first')
    }

    // Routes are NOT registered here — the auth module registers them
    // after creating the authenticate middleware (to ensure proper ordering)
  },

  async onStop() {
    masterKeyRef = null
  },
}
