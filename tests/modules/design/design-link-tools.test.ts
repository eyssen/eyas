// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryDb } from '../../helpers/test-db'
import { createDesignTables } from '@modules/design/schema'
import { createDesignStore } from '@modules/design/design-store'
import { createDesignService, type DesignService } from '@modules/design/design-service'
import { createDesignTools } from '@modules/design/design-tools'

let root: string
let svc: DesignService
let tools: ReturnType<typeof createDesignTools>
const board = () => '<x-dc><helmet><style>body{margin:0}</style></helmet><p>hi</p></x-dc>'
const ctx = { conversationId: 'conv-1', projectId: 'proj-1', agentId: 'agent-1' } as any

function tool(name: string) {
  const found = tools.find((t) => t.name === name)
  if (!found) throw new Error(`no tool named ${name}`)
  return found
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-designlink-'))
  const db = createMemoryDb()
  createDesignTables(db)
  svc = createDesignService(db, createDesignStore(join(root, 'designs')))
  tools = createDesignTools({ designs: () => svc })
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('design_link', () => {
  it('reaches CLI providers, like the rest of the design tools', () => {
    // Both MCP bridges filter on category; 'shell' and 'browser' are dropped.
    expect(tool('design_link').category).toBe('custom')
    expect(tool('design_unlink').category).toBe('custom')
  })

  it('attaches to the run own conversation by default', async () => {
    const d = svc.create({ title: 'X', files: { 'Main.dc.html': board() } })
    const res: any = await tool('design_link').execute({ designId: d.id }, ctx)
    expect(res.ok).toBe(true)
    expect(svc.linkedTo('conversations', 'conv-1').map((r) => r.id)).toEqual([d.id])
  })

  it('attaches to a project when asked', async () => {
    const d = svc.create({ title: 'X', files: { 'Main.dc.html': board() } })
    await tool('design_link').execute({ designId: d.id, scope: 'project', targetId: 'proj-9' }, ctx)
    expect(svc.linkedTo('projects', 'proj-9').map((r) => r.id)).toEqual([d.id])
    expect(svc.linkedTo('conversations', 'conv-1')).toHaveLength(0)
  })

  it('falls back to the run own project when scope is project and no target is given', async () => {
    const d = svc.create({ title: 'X', files: { 'Main.dc.html': board() } })
    await tool('design_link').execute({ designId: d.id, scope: 'project' }, ctx)
    expect(svc.linkedTo('projects', 'proj-1').map((r) => r.id)).toEqual([d.id])
  })

  it('refuses a design that does not exist, rather than storing a dangling link', async () => {
    const res: any = await tool('design_link').execute({ designId: 'ghost' }, ctx)
    expect(res.error).toMatch(/ghost/)
    expect(svc.linkedTo('conversations', 'conv-1')).toHaveLength(0)
  })

  it('refuses a scope it does not have', async () => {
    // An owner module is a namespace, not a free string: the model must not be
    // able to invent one and hide a link where nothing will ever read it.
    const d = svc.create({ title: 'X', files: { 'Main.dc.html': board() } })
    const res: any = await tool('design_link').execute({ designId: d.id, scope: 'knowledge' }, ctx)
    expect(res.error).toMatch(/scope/i)
  })

  it('refuses when there is no conversation to attach to', async () => {
    const d = svc.create({ title: 'X', files: { 'Main.dc.html': board() } })
    const res: any = await tool('design_link').execute({ designId: d.id }, { agentId: 'a' } as any)
    expect(res.error).toBeTruthy()
  })

  it('is idempotent', async () => {
    const d = svc.create({ title: 'X', files: { 'Main.dc.html': board() } })
    await tool('design_link').execute({ designId: d.id }, ctx)
    await tool('design_link').execute({ designId: d.id }, ctx)
    expect(svc.linkedTo('conversations', 'conv-1')).toHaveLength(1)
  })
})

describe('design_unlink', () => {
  it('detaches from the run own conversation', async () => {
    const d = svc.create({ title: 'X', files: { 'Main.dc.html': board() } })
    svc.link(d.id, 'conversations', 'conv-1')
    const res: any = await tool('design_unlink').execute({ designId: d.id }, ctx)
    expect(res.ok).toBe(true)
    expect(svc.linkedTo('conversations', 'conv-1')).toHaveLength(0)
  })

  it('leaves the design itself alone', async () => {
    const d = svc.create({ title: 'X', files: { 'Main.dc.html': board() } })
    svc.link(d.id, 'conversations', 'conv-1')
    await tool('design_unlink').execute({ designId: d.id }, ctx)
    expect(svc.get(d.id)).not.toBeNull()
  })

  it('does not complain about a link that was never there', async () => {
    const d = svc.create({ title: 'X', files: { 'Main.dc.html': board() } })
    expect((await tool('design_unlink').execute({ designId: d.id }, ctx) as any).ok).toBe(true)
  })
})

describe('design_read — the cheapest answer that can be correct', () => {
  // Sized like a real one: the shipped Odoo canvas's Tokens artboard is 5.1 KB.
  // On a 130-character toy the summary is naturally bigger than the source, and
  // the saving this parameter exists for would not be visible at all.
  const tokens = '<x-dc><helmet><style>body{margin:0}</style></helmet><h2>Tokens</h2>'
    + '<p style="color:#71639e;font-family:SFMono-Regular">swatch</p>'.repeat(80)
    + '</x-dc>'
  const comps = '<x-dc><helmet><style>body{margin:0}</style></helmet><h2>Gombok</h2><button style="background:#28a745">ok</button></x-dc>'

  function withDesign() {
    return svc.create({ title: 'Odoo', files: { 'Tokens.dc.html': tokens, 'Components.dc.html': comps } })
  }

  it('returns one part, and nothing from another', async () => {
    const d = withDesign()
    const out: any = await tool('design_read').execute({ designId: d.id, part: 'tokens' }, ctx)
    expect(out.part).toBe('tokens')
    expect(out.content).toContain('#71639e')
    expect(out.content).not.toContain('#28a745')
    // The whole point: a part is a summary. Against a realistically sized
    // artboard it is a small fraction of the source.
    expect(out.content.length).toBeLessThan(tokens.length / 10)
  })

  it('still returns one artboard whole when markup is what is needed', async () => {
    const d = withDesign()
    const out: any = await tool('design_read').execute({ designId: d.id, file: 'Components.dc.html' }, ctx)
    expect(out.content).toContain('<button')
  })

  it('prefers the part when both are given, because it is the cheaper answer', async () => {
    const d = withDesign()
    const out: any = await tool('design_read').execute({ designId: d.id, part: 'tokens', file: 'Components.dc.html' }, ctx)
    expect(out.part).toBe('tokens')
    expect(out.content).not.toContain('<button')
  })

  it('names the parts that DO exist when asked for one that does not', async () => {
    const d = withDesign()
    const out: any = await tool('design_read').execute({ designId: d.id, part: 'page' }, ctx)
    expect(out.error).toContain('page')
    expect(out.error).toContain('Tokens.dc.html')
  })

  it('rejects a part name that is not one of ours', async () => {
    const d = withDesign()
    const out: any = await tool('design_read').execute({ designId: d.id, part: 'banana' }, ctx)
    expect(out.error).toMatch(/unknown part/i)
  })
})
