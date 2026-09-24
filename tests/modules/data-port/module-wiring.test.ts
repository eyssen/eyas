// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The module entry point hands the job runner the background model service
// through a getter, never by value: the model module publishes
// ctx.auxiliaryModel, and module start order is not something a job should
// depend on. A service published after the data-port started must still be
// the one an enriched import asks.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { dataPortModule } from '@modules/data-port/index'
import type { createDataPortService } from '@modules/data-port/service'
import { auxOk, createFakeAuxiliaryModel } from '../../helpers/fake-auxiliary-model'

type DataPortService = ReturnType<typeof createDataPortService>

const wait = async (done: () => boolean, ms = 5000): Promise<void> => {
  const started = Date.now()
  while (!done() && Date.now() - started < ms) await new Promise((r) => setTimeout(r, 10))
}

const logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return logger } }

describe('data-port module wiring — background model service', () => {
  let root: string
  let ctx: Record<string, unknown>

  beforeEach(async () => {
    root = join(tmpdir(), `eyas-dp-wiring-${process.pid}-${Math.random().toString(36).slice(2)}`)
    const note = join(root, 'src', 'ai-memory', 'plain_note.md')
    mkdirSync(dirname(note), { recursive: true })
    writeFileSync(note, `Undeclared note. ${'text '.repeat(60)}`)
    ctx = { db: createMemoryDb(), config: { dataDir: join(root, 'data') }, logger, http: new Hono() }
    await dataPortModule.onRegister!(ctx as never)
    await dataPortModule.onStart!(ctx as never)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** Scans the tree, imports every importable row with enrichment ticked, returns the finished job. */
  const enrichedImport = async () => {
    const service = ctx.dataPort as DataPortService
    const scan = service.scanPath('auto', join(root, 'src'))
    await wait(() => service.getScan(scan.scanId)?.status === 'done')
    const rows = service.listCandidates(scan.scanId, {}, { offset: 0, limit: 500, order: 'seq' }).items
    const selection = rows.filter((c) => c.target !== 'none').map((c) => ({ candidateId: c.id }))
    expect(selection.length).toBeGreaterThan(0)
    const job = service.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection, enrich: true })
    await wait(() => ['completed', 'failed'].includes(service.getJob(job.id)?.status ?? ''))
    return service.getJob(job.id)!
  }

  it('asks the service the model module published after the data-port started', async () => {
    const aux = createFakeAuxiliaryModel(auxOk(JSON.stringify({ summary_one_line: 'model summary' })))
    ctx.auxiliaryModel = aux
    const done = await enrichedImport()
    expect(done.status).toBe('completed')
    expect(aux.calls).toHaveLength(1)
    expect(aux.calls[0].purpose).toBe('data_port_enrichment')
    expect(done.stats.aiEnriched).toBe(1)
  })

  it('makes no model call and counts nothing when no service is published', async () => {
    const done = await enrichedImport()
    expect(done.status).toBe('completed')
    expect(done.stats.aiEnriched + done.stats.aiFallback).toBe(0)
  })
})
