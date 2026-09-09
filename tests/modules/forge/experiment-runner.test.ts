// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db.js'
import { createForgeTables } from '@modules/forge/schema'
import { createExperimentRunner } from '@modules/forge/experiment-runner'
import type { EyasDb } from '@core/types'

describe('Forge — ExperimentRunner', () => {
  let db: EyasDb
  let proposalStore: { setExperiment: ReturnType<typeof vi.fn> }
  let runner: ReturnType<typeof createExperimentRunner>

  beforeEach(() => {
    db = createMemoryDb() as EyasDb
    createForgeTables(db)
    proposalStore = { setExperiment: vi.fn() }
    runner = createExperimentRunner(db, proposalStore)
  })

  it('create() returns experiment with running status and calls proposalStore.setExperiment', () => {
    const exp = runner.create('prop-1')

    expect(exp.id).toBeTruthy()
    expect(exp.proposalId).toBe('prop-1')
    expect(exp.conversationId).toMatch(/^forge-exp-/)
    expect(exp.status).toBe('running')
    expect(exp.result).toBeNull()
    expect(exp.startedAt).toBeTruthy()
    expect(exp.completedAt).toBeNull()
    expect(proposalStore.setExperiment).toHaveBeenCalledWith('prop-1', exp.id)
  })

  it('get() retrieves a created experiment', () => {
    const created = runner.create('prop-2')
    const fetched = runner.get(created.id)

    expect(fetched).toBeDefined()
    expect(fetched!.id).toBe(created.id)
    expect(fetched!.status).toBe('running')
  })

  it('get() returns undefined for unknown id', () => {
    expect(runner.get('nonexistent')).toBeUndefined()
  })

  it('complete() sets status to passed with result text', () => {
    const exp = runner.create('prop-3')
    runner.complete(exp.id, 'passed', 'All checks green')

    const updated = runner.get(exp.id)
    expect(updated!.status).toBe('passed')
    expect(updated!.result).toBe('All checks green')
    expect(updated!.completedAt).toBeTruthy()
  })

  it('complete() sets status to failed with result text', () => {
    const exp = runner.create('prop-4')
    runner.complete(exp.id, 'failed', 'Regression detected')

    const updated = runner.get(exp.id)
    expect(updated!.status).toBe('failed')
    expect(updated!.result).toBe('Regression detected')
  })

  it('listForProposal() returns experiments ordered by startedAt DESC', () => {
    runner.create('prop-5')
    runner.create('prop-5')
    runner.create('prop-other')

    const list = runner.listForProposal('prop-5')
    expect(list).toHaveLength(2)
    expect(list.every(e => e.proposalId === 'prop-5')).toBe(true)
  })
})
