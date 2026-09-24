// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A real PrivacyService over an in-memory DB and a privacy.yaml in a temp
// dir — never the repo's or the operator's files.

import { vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stringify } from 'yaml'
import { createMemoryDb } from './test-db'
import { createPolicyStore, createPrivacyPolicyTable, type PolicyStore } from '@modules/privacy/policy-store'
import { createPrivacyService, type PrivacyService } from '@modules/privacy/service'
import type { PrivacyPolicyInput } from '@modules/privacy/policy'

export interface PrivacyFixture {
  service: PrivacyService
  store: PolicyStore
  db: any
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
  bus: { emit: ReturnType<typeof vi.fn> }
  yamlPath: string
  /** Replaces privacy.yaml with `{ privacy: body }` (or raw text). */
  writeYaml(body: PrivacyPolicyInput | Record<string, unknown> | string): void
  cleanup(): void
}

/** The v2 YAML text for a policy body. */
export function policyYaml(body: PrivacyPolicyInput | Record<string, unknown>): string {
  return stringify({ privacy: body })
}

export function createPrivacyFixture(policy: PrivacyPolicyInput | Record<string, unknown> | string | null = {}): PrivacyFixture {
  const dir = mkdtempSync(join(tmpdir(), 'eyas-privacy-'))
  const yamlPath = join(dir, 'privacy.yaml')
  const writeYaml = (body: PrivacyPolicyInput | Record<string, unknown> | string) =>
    writeFileSync(yamlPath, typeof body === 'string' ? body : policyYaml(body))
  if (policy !== null) writeYaml(policy)

  const db = createMemoryDb()
  createPrivacyPolicyTable(db)
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const bus = { emit: vi.fn() }
  const store = createPolicyStore({ db, logger: logger as any, yamlPath })
  const service = createPrivacyService({ store, bus, logger: logger as any })
  return { service, store, db, logger, bus, yamlPath, writeYaml, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
