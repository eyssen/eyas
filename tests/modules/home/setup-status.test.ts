// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createSetupStatus } from '@modules/home/setup-status'
import { buildSetupChecks, type SetupStatusModuleDeps } from '@modules/home/routes'

describe('setup status aggregate', () => {
  it('reports each check as done / not done / unknown', () => {
    const status = createSetupStatus({
      providers: () => 2, projects: () => 0, agents: () => 1,
      prompts: () => null, backups: () => 0,
    }, 60_000)
    const { items } = status.get()
    expect(items.find((i) => i.id === 'providers')?.done).toBe(true)
    expect(items.find((i) => i.id === 'projects')?.done).toBe(false)
    expect(items.find((i) => i.id === 'prompts')?.done).toBeNull()
  })

  it('serves from cache within the TTL instead of re-querying', () => {
    const providers = vi.fn(() => 1)
    const status = createSetupStatus(
      { providers, projects: () => 1, agents: () => 1, prompts: () => 1, backups: () => 1 },
      60_000,
    )
    status.get()
    status.get()
    expect(providers).toHaveBeenCalledTimes(1)
  })
})

describe('search check (fix round 1)', () => {
  // /api/v1/search/sources returns the bare array (search/routes.ts:62-64),
  // not a { sources: [...] } envelope. The original frontend predicate
  // (setup-recommendations-card.tsx:153-154) reads `.data?.sources?.length`
  // off that array, which is always undefined — this test would have FAILED
  // against that logic (it always resolved to 0/false, never a positive
  // count). The server-side check must read the array's own length instead.
  it('reports the real count against the actual /search/sources response shape (a bare array)', () => {
    const deps = {
      search: { sources: { list: () => [{ id: 's1' }, { id: 's2' }] } },
    } as unknown as SetupStatusModuleDeps
    const checks = buildSetupChecks(deps)
    expect(checks.search()).toBe(2)
  })

  it('still reports 0 for an empty source list', () => {
    const deps = {
      search: { sources: { list: () => [] } },
    } as unknown as SetupStatusModuleDeps
    const checks = buildSetupChecks(deps)
    expect(checks.search()).toBe(0)
  })

  it('stays defensive: also accepts a { sources: [...] } envelope, should the endpoint ever be normalised', () => {
    const deps = {
      search: { sources: { list: () => ({ sources: [{ id: 's1' }] }) } },
    } as unknown as SetupStatusModuleDeps
    const checks = buildSetupChecks(deps)
    expect(checks.search()).toBe(1)
  })

  it('reports unknown (null) when the search module is disabled/absent', () => {
    const deps = {} as unknown as SetupStatusModuleDeps
    const checks = buildSetupChecks(deps)
    expect(checks.search()).toBeNull()
  })
})
