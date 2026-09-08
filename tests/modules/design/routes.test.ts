// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryDb } from '../../helpers/test-db'
import { createDesignTables } from '@modules/design/schema'
import { createDesignStore } from '@modules/design/design-store'
import { createDesignService, type DesignService } from '@modules/design/design-service'
import { createDesignAiRunService, type DesignAiRunService } from '@modules/design/design-ai-runs'
import { createDesignRoutes } from '@modules/design/routes'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const board = (body = '<p>hi</p>') => `<x-dc><helmet><style>body{margin:0}</style></helmet>${body}</x-dc>`

function registryWithDesign() {
  const reg = createPermissionRegistry()
  reg.registerSubject('Design', {
    actions: ['read', 'create', 'update', 'delete', 'manage'],
    defaults: { owner: ['manage'], admin: ['manage'], user: ['read', 'create', 'update', 'delete'], agent: ['read', 'create', 'update'], guest: ['read'] },
  })
  return reg
}

let root: string
let designs: DesignService
let runs: DesignAiRunService
let clock: number
let app: Hono

function mount(role: 'owner' | 'guest' = 'owner', extra: Record<string, unknown> = {}) {
  const ability = buildAbilityForRole(role, registryWithDesign())
  const a = new Hono()
  a.use('*', async (c: any, next: any) => { c.set('userId', 'user-1'); c.set('ability', ability); await next() })
  createDesignRoutes(a, { designs, runs, logger: noopLogger, ...extra } as any)
  return a
}

const json = (body: unknown, method = 'POST') => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-designroutes-'))
  const db = createMemoryDb()
  createDesignTables(db)
  designs = createDesignService(db, createDesignStore(join(root, 'designs')))
  clock = 1_700_000_000_000
  runs = createDesignAiRunService(db, () => clock)
  app = mount()
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('CRUD', () => {
  it('creates, reads and lists', async () => {
    const created = await app.request('/api/v1/designs', json({ title: 'Landing', kind: 'landing' }))
    expect(created.status).toBe(201)
    const design = (await created.json()).design
    expect((await (await app.request(`/api/v1/designs/${design.id}`)).json()).design.title).toBe('Landing')
    expect((await (await app.request('/api/v1/designs?kind=landing')).json()).designs).toHaveLength(1)
  })

  it('reports who links to the design alongside it, for a delete confirmation', async () => {
    const d = designs.create({ title: 'Shared' })
    designs.link(d.id, 'conversations', 'c1')
    designs.link(d.id, 'projects', 'p1')

    const body = await (await app.request(`/api/v1/designs/${d.id}`)).json()
    expect(body.links).toEqual({ total: 2, byModule: { conversations: 1, projects: 1 } })
  })

  it('deletes a design with its versions and links', async () => {
    const d = designs.create({ title: 'Doomed' })
    designs.link(d.id, 'conversations', 'c1')

    expect((await app.request(`/api/v1/designs/${d.id}`, { method: 'DELETE' })).status).toBe(200)
    expect(designs.get(d.id)).toBeNull()
    expect(designs.linkedTo('conversations', 'c1')).toEqual([])
    expect((await app.request(`/api/v1/designs/${d.id}`)).status).toBe(404)
  })

  it('404s an unknown design and 400s a missing title', async () => {
    expect((await app.request('/api/v1/designs/ghost')).status).toBe(404)
    expect((await app.request('/api/v1/designs', json({}))).status).toBe(400)
  })

  it('422s a create whose canvas fails the gate, with the issues', async () => {
    const res = await app.request('/api/v1/designs', json({ title: 'Bad', files: { 'Main.dc.html': '<div/>' } }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.issues.map((i: any) => i.code)).toContain('missing-x-dc')
    expect(designs.list()).toHaveLength(0)
  })

  it('patches metadata without bumping the content version', async () => {
    const d = designs.create({ title: 'X' })
    const res = await app.request(`/api/v1/designs/${d.id}`, json({ title: 'Renamed', tags: ['hero'] }, 'PATCH'))
    expect(res.status).toBe(200)
    const design = (await res.json()).design
    expect(design.title).toBe('Renamed')
    expect(design.tags).toEqual(['hero'])
    expect(design.currentVersion).toBe(1)
  })

  it('writes and deletes a file, and rejects an invalid one', async () => {
    const d = designs.create({ title: 'X' })
    const ok = await app.request(`/api/v1/designs/${d.id}/files/Hero.dc.html`, json({ content: board() }, 'PUT'))
    expect(ok.status).toBe(200)
    expect((await ok.json()).design.artboards).toEqual(['Hero.dc.html', 'Main.dc.html'])

    const bad = await app.request(`/api/v1/designs/${d.id}/files/Broken.dc.html`, json({ content: '<div/>' }, 'PUT'))
    expect(bad.status).toBe(422)

    const del = await app.request(`/api/v1/designs/${d.id}/files/Hero.dc.html`, { method: 'DELETE' })
    expect((await del.json()).design.artboards).toEqual(['Main.dc.html'])
  })

  it('replaces the whole files record', async () => {
    const d = designs.create({ title: 'X' })
    const res = await app.request(`/api/v1/designs/${d.id}/files`, json({ files: { 'Main.dc.html': board('<b>new</b>') } }, 'PUT'))
    expect((await res.json()).design.currentVersion).toBe(2)
  })
})

describe('render', () => {
  it('returns the srcdoc and the sandbox together', async () => {
    const d = designs.create({ title: 'X' })
    const res = await app.request(`/api/v1/designs/${d.id}/render/Main.dc.html`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sandbox).toBe('allow-scripts')
    expect(body.sandbox).not.toContain('allow-same-origin')
    expect(body.srcdoc).toContain('Content-Security-Policy')
  })

  it('404s a file that is not an artboard', async () => {
    const d = designs.create({ title: 'X' })
    expect((await app.request(`/api/v1/designs/${d.id}/render/canvas.json`)).status).toBe(404)
    expect((await app.request(`/api/v1/designs/${d.id}/render/Ghost.dc.html`)).status).toBe(404)
  })
})

describe('versions, import and export', () => {
  it('lists versions and restores one', async () => {
    const d = designs.create({ title: 'X' })
    designs.writeFile(d.id, 'Hero.dc.html', board())
    expect((await (await app.request(`/api/v1/designs/${d.id}/versions`)).json()).versions).toHaveLength(2)
    const res = await app.request(`/api/v1/designs/${d.id}/restore/1`, { method: 'POST' })
    expect((await res.json()).design.artboards).toEqual(['Main.dc.html'])
  })

  it('imports a published canvas page', async () => {
    const state = JSON.stringify({ title: 'Imported', content: { files: { 'Main.dc.html': board() } } })
    const page = `<html><body><script type="application/json" id="appifact-doc">\n${state}\n</script></body></html>`
    const res = await app.request('/api/v1/designs/import', json({ page }))
    expect(res.status).toBe(201)
    expect((await res.json()).design.title).toBe('Imported')
  })

  it('422s a live-store page', async () => {
    const state = JSON.stringify({ title: 'X', store: 'db', content: { files: { 'Main.dc.html': board() } } })
    const page = `<html><body><script type="application/json" id="appifact-doc">\n${state}\n</script></body></html>`
    const res = await app.request('/api/v1/designs/import', json({ page }))
    expect(res.status).toBe(422)
    expect((await res.json()).message).toContain('live store')
  })

  it('exports files, the portable document and a standalone page', async () => {
    const d = designs.create({ title: 'X' })
    expect((await (await app.request(`/api/v1/designs/${d.id}/export?format=files`)).json()).files['Main.dc.html']).toBeDefined()

    const doc = await app.request(`/api/v1/designs/${d.id}/export?format=document`)
    expect(doc.headers.get('content-disposition')).toContain('.canvas.json')
    expect(JSON.parse(await doc.text()).content.files['Main.dc.html']).toBeDefined()

    const html = await app.request(`/api/v1/designs/${d.id}/export?format=html`)
    const page = await html.text()
    expect(page).toContain('sandbox="allow-scripts"')
    expect(page).not.toContain('allow-same-origin')
  })

  it('400s an unknown export format', async () => {
    const d = designs.create({ title: 'X' })
    expect((await app.request(`/api/v1/designs/${d.id}/export?format=pdf`)).status).toBe(400)
  })
})

describe('AI edits', () => {
  it('503s when no provider is configured', async () => {
    const d = designs.create({ title: 'X' })
    const res = await app.request(`/api/v1/designs/${d.id}/ai`, json({ instruction: 'make it blue' }))
    expect(res.status).toBe(503)
  })

  it('applies a valid edit as a new ai-origin version', async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ files: { 'Main.dc.html': board('<b>blue</b>') } }))
    const withAi = mount('owner', { complete })
    const d = designs.create({ title: 'X' })
    const res = await withAi.request(`/api/v1/designs/${d.id}/ai`, json({ instruction: 'make it bold' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.design.currentVersion).toBe(2)
    expect(designs.versions(d.id).at(-1)!.origin).toBe('ai')
  })

  it('422s an edit that fails the gate and keeps the previous version', async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ files: { 'Main.dc.html': '<div/>' } }))
    const withAi = mount('owner', { complete })
    const d = designs.create({ title: 'X' })
    const res = await withAi.request(`/api/v1/designs/${d.id}/ai`, json({ instruction: 'break it' }))
    expect(res.status).toBe(422)
    expect(designs.get(d.id)!.currentVersion).toBe(1)
  })

  it('records a successful edit as a finished run', async () => {
    const complete = vi.fn(async () => { clock += 523_000; return JSON.stringify({ files: { 'Main.dc.html': board('<b>blue</b>') } }) })
    const withAi = mount('owner', { complete })
    const d = designs.create({ title: 'X' })
    await withAi.request(`/api/v1/designs/${d.id}/ai`, json({ instruction: 'make it bold' }))

    const run = runs.latest(d.id)!
    expect(run.status).toBe('ok')
    expect(run.instruction).toBe('make it bold')
    expect(run.durationMs).toBe(523_000)
    expect(run.versionBefore).toBe(1)
    expect(run.versionAfter).toBe(2)
    expect(run.tier).toBe('whole-canvas')
  })

  it('records a rejected edit with the reason, so a reload can still show it', async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ files: { 'Main.dc.html': '<div/>' } }))
    const withAi = mount('owner', { complete })
    const d = designs.create({ title: 'X' })
    await withAi.request(`/api/v1/designs/${d.id}/ai`, json({ instruction: 'break it' }))

    const run = runs.latest(d.id)!
    expect(run.status).toBe('failed')
    expect(run.message).toBeTruthy()
    expect(run.versionAfter).toBeNull()
  })

  it('records a run that threw rather than leaving it running forever', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('provider exploded'))
    const withAi = mount('owner', { complete })
    const d = designs.create({ title: 'X' })
    // The handler rethrows after recording; Hono's `request` types the result
    // as `Response | Promise<Response>`, so it is awaited inside try/catch.
    try { await withAi.request(`/api/v1/designs/${d.id}/ai`, json({ instruction: 'x' })) } catch { /* expected */ }

    const run = runs.latest(d.id)!
    expect(run.status).toBe('failed')
    expect(run.message).toContain('provider exploded')
  })

  it('serves the run history with the server clock', async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ files: { 'Main.dc.html': board('<b>x</b>') } }))
    const withAi = mount('owner', { complete })
    const d = designs.create({ title: 'X' })
    await withAi.request(`/api/v1/designs/${d.id}/ai`, json({ instruction: 'first' }))

    const body = await (await withAi.request(`/api/v1/designs/${d.id}/ai/runs`)).json()
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0].instruction).toBe('first')
    // Without the server's own clock the panel cannot tell elapsed time from skew.
    expect(body.now).toBe(clock)
  })

  it('returns a candidate without committing when asked', async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ files: { 'Main.dc.html': board('<b>x</b>') } }))
    const withAi = mount('owner', { complete })
    const d = designs.create({ title: 'X' })
    const res = await withAi.request(`/api/v1/designs/${d.id}/ai`, json({ instruction: 'x', commit: false }))
    expect((await res.json()).candidate['Main.dc.html']).toContain('<b>x</b>')
    expect(designs.get(d.id)!.currentVersion).toBe(1)
  })

})

describe('links and permissions', () => {
  it('links a design to a conversation and lists by owner', async () => {
    const d = designs.create({ title: 'X' })
    expect((await app.request(`/api/v1/designs/${d.id}/links`, json({ ownerModule: 'conversations', ownerId: 'c1' }))).status).toBe(200)
    expect((await (await app.request('/api/v1/designs?ownerModule=conversations&ownerId=c1')).json()).designs).toHaveLength(1)
    await app.request(`/api/v1/designs/${d.id}/links/conversations/c1`, { method: 'DELETE' })
    expect((await (await app.request('/api/v1/designs?ownerModule=conversations&ownerId=c1')).json()).designs).toHaveLength(0)
  })

  it('403s a guest creating or deleting, and lets them read', async () => {
    const d = designs.create({ title: 'X' })
    const guest = mount('guest')
    expect((await guest.request('/api/v1/designs', json({ title: 'x' }))).status).toBe(403)
    expect((await guest.request(`/api/v1/designs/${d.id}`, { method: 'DELETE' })).status).toBe(403)
    expect((await guest.request('/api/v1/designs')).status).toBe(200)
  })
})

describe('WYSIWYG persistence', () => {
  const withStyle = '<x-dc><helmet><style>body{margin:0}</style></helmet><p style="color: #000">x</p></x-dc>'

  it('splices an edited template back, keeping the helmet', async () => {
    const d = designs.create({ title: 'X', files: { 'Main.dc.html': withStyle } })
    const res = await app.request(`/api/v1/designs/${d.id}/body`, json({
      file: 'Main.dc.html', template: '<p style="color: #f00">x</p>',
    }, 'PUT'))
    expect(res.status).toBe(200)
    const updated = (await res.json()).design
    expect(updated.files['Main.dc.html']).toContain('color: #f00')
    expect(updated.files['Main.dc.html']).toContain('<helmet>')
    expect(updated.currentVersion).toBe(2)
  })

  it('422s a template that would truncate the artboard', async () => {
    const d = designs.create({ title: 'X', files: { 'Main.dc.html': withStyle } })
    const res = await app.request(`/api/v1/designs/${d.id}/body`, json({
      file: 'Main.dc.html', template: '<p>keep</p></x-dc><script>alert(1)</script>',
    }, 'PUT'))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('SpliceError')
    expect(designs.get(d.id)!.currentVersion).toBe(1)
  })

  it('404s an unknown artboard', async () => {
    const d = designs.create({ title: 'X' })
    expect((await app.request(`/api/v1/designs/${d.id}/body`, json({ file: 'Ghost.dc.html', template: '<p/>' }, 'PUT'))).status).toBe(404)
  })

  it('writes a tweak value back as the declared default', async () => {
    const withProps = `<x-dc><p style="color: {{accent}}">x</p></x-dc>
<script data-dc-script data-props='{"accent":{"editor":"color","default":"#000000"}}'>class Component extends DCLogic { renderVals() { return { accent: this.props.accent } } }</script>`
    const d = designs.create({ title: 'X', files: { 'Main.dc.html': withProps } })
    const res = await app.request(`/api/v1/designs/${d.id}/props`, json({
      file: 'Main.dc.html', prop: 'accent', value: '#0a2540',
    }, 'PUT'))
    expect(res.status).toBe(200)
    expect((await res.json()).design.files['Main.dc.html']).toContain('#0a2540')
  })

  it('422s a tweak the artboard does not declare', async () => {
    const d = designs.create({ title: 'X' })
    const res = await app.request(`/api/v1/designs/${d.id}/props`, json({
      file: 'Main.dc.html', prop: 'ghost', value: 1,
    }, 'PUT'))
    expect(res.status).toBe(422)
  })
})
