// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryDb } from '../../helpers/test-db'
import { createDesignTables } from '@modules/design/schema'
import { createDesignStore } from '@modules/design/design-store'
import { createDesignService, type DesignService } from '@modules/design/design-service'
import { buildDesignContext, DESIGN_SECTION_KEY } from '@modules/design/design-context'

let root: string
let svc: DesignService
const board = (body = '<p>hi</p>') => `<x-dc><helmet><style>body{margin:0}</style></helmet>${body}</x-dc>`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-designctx-'))
  const db = createMemoryDb()
  createDesignTables(db)
  svc = createDesignService(db, createDesignStore(join(root, 'designs')))
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('buildDesignContext', () => {
  it('returns null when nothing is linked', () => {
    expect(buildDesignContext(svc, 'c1')).toBeNull()
  })

  it('announces a design without handing over its source', () => {
    const d = svc.create({ title: 'Landing', files: { 'Main.dc.html': board('<h1>Acme</h1>') } })
    svc.link(d.id, 'conversations', 'c1')
    const ctx = buildDesignContext(svc, 'c1')!
    expect(ctx.designIds).toEqual([d.id])
    expect(ctx.content).toContain('### Landing')
    expect(ctx.content).toContain('Main.dc.html')
    expect(ctx.content).not.toContain('<h1>Acme</h1>')
  })

  it('indexes a large canvas instead of swallowing the turn', () => {
    const big = board('<p>' + 'x'.repeat(13000) + '</p>')
    const d = svc.create({ title: 'Big', files: { 'Main.dc.html': big } })
    svc.link(d.id, 'conversations', 'c1')
    const ctx = buildDesignContext(svc, 'c1')!
    expect(ctx.content).not.toContain('x'.repeat(1000))
    expect(ctx.content).toContain('design_read')
    expect(ctx.content).toContain('Main.dc.html')
    // The index has to be cheap whatever the canvas weighs.
    expect(ctx.content.length).toBeLessThan(1500)
  })

  it('does not inline even a tiny canvas', () => {
    // The block is paid on EVERY turn; a fetch is paid once. At two turns the
    // fetch already wins, and it is the only shape that does not grow with the
    // canvas — so there is no size at which inlining is the better trade.
    const d = svc.create({ title: 'Sketch', files: { 'Main.dc.html': board('<h1>Hello</h1>') } })
    svc.link(d.id, 'conversations', 'c1')
    const content = buildDesignContext(svc, 'c1')!.content
    expect(content).not.toContain('<h1>Hello</h1>')
    expect(content).not.toContain('<x-dc>')
  })

  it('costs about the same for a tiny canvas as for a large one', () => {
    const small = svc.create({ title: 'Small', files: { 'Main.dc.html': board('<h1>Hi</h1>') } })
    svc.link(small.id, 'conversations', 'c-small')
    const big = svc.create({ title: 'Big', files: {
      'Tokens.dc.html': board('<p>' + 'x'.repeat(9000) + '</p>'),
      'Typography.dc.html': board('<p>' + 'y'.repeat(9000) + '</p>'),
      'Components.dc.html': board('<p>' + 'z'.repeat(9000) + '</p>'),
    } })
    svc.link(big.id, 'conversations', 'c-big')

    const smallLen = buildDesignContext(svc, 'c-small')!.content.length
    const bigLen = buildDesignContext(svc, 'c-big')!.content.length
    expect(bigLen).toBeLessThan(smallLen * 2)
  })

  it('tells the agent to follow the design, not merely that one is attached', () => {
    const d = svc.create({ title: 'X', files: { 'Main.dc.html': board() } })
    svc.link(d.id, 'conversations', 'c1')
    expect(buildDesignContext(svc, 'c1')!.content).toMatch(/follow this design/i)
  })

  it('lists every linked design', () => {
    const a = svc.create({ title: 'A' })
    const b = svc.create({ title: 'B' })
    svc.link(a.id, 'conversations', 'c1')
    svc.link(b.id, 'conversations', 'c1')
    const ctx = buildDesignContext(svc, 'c1')!
    expect(ctx.designIds.sort()).toEqual([a.id, b.id].sort())
    expect(ctx.content).toContain('### A')
    expect(ctx.content).toContain('### B')
  })

  it('tells the agent how to write back', () => {
    const d = svc.create({ title: 'A' })
    svc.link(d.id, 'conversations', 'c1')
    expect(buildDesignContext(svc, 'c1')!.content).toContain('design_write')
  })

  it('uses a section key the recorder does not mistake for a skill', () => {
    expect(DESIGN_SECTION_KEY).toBe('design-context')
    expect(DESIGN_SECTION_KEY).not.toBe('skill')
  })
})

describe('buildDesignContext — the project is not resolved here', () => {
  it('ignores designs attached only to the project', () => {
    // Inheritance happens by COPY when the conversation joins the project (see
    // board/routes.ts), exactly as `indexedSources` and `workingDirectories`
    // do. Resolving it again at read time would be a second, invisible source
    // of truth that the detach button in the UI could not act on.
    const shared = svc.create({ title: 'Project system', files: { 'Main.dc.html': board('<p>shared</p>') } })
    svc.link(shared.id, 'projects', 'proj-1')
    expect(buildDesignContext(svc, 'conv-1')).toBeNull()
  })

  it('reads a copied link like any other, with nothing marking it special', () => {
    const shared = svc.create({ title: 'Project system', files: { 'Main.dc.html': board('<p>shared</p>') } })
    svc.link(shared.id, 'projects', 'proj-1')
    svc.link(shared.id, 'conversations', 'conv-1') // what the copy does

    const block = buildDesignContext(svc, 'conv-1')
    expect(block?.designIds).toEqual([shared.id])
    expect(block?.content).not.toMatch(/inherit|from the project/i)
  })
})
