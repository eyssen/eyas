// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryDb } from '../../helpers/test-db'
import { createDesignTables } from '@modules/design/schema'
import { createDesignStore } from '@modules/design/design-store'
import { createDesignService, type DesignService } from '@modules/design/design-service'
import { createDesignAiRunService } from '@modules/design/design-ai-runs'
import { createDesignRoutes } from '@modules/design/routes'
import { PrintRenderError, PrintTargetError, type PrintService } from '@modules/design/print-service'
import { BrowserUnavailableError } from '@shared/playwright-loader'
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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])

let root: string
let db: any
let designs: DesignService
let designId: string

function stubPrint(overrides: Partial<PrintService> = {}): PrintService {
  return {
    async status() { return { available: true } },
    async png() { return PNG },
    async pdf() { return PDF },
    ...overrides,
  }
}

function mount(print?: PrintService) {
  const ability = buildAbilityForRole('owner', registryWithDesign())
  const a = new Hono()
  a.use('*', async (c: any, next: any) => { c.set('userId', 'user-1'); c.set('ability', ability); await next() })
  createDesignRoutes(a, { designs, runs: createDesignAiRunService(db), logger: noopLogger, print } as any)
  return a
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-printroutes-'))
  db = createMemoryDb()
  createDesignTables(db)
  designs = createDesignService(db, createDesignStore(join(root, 'designs')))
  designId = designs.create({ title: 'Spring Flyer', files: { 'Main.dc.html': board() } }).id
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('print-status', () => {
  it('is not swallowed by the /designs/:id route', async () => {
    // Hono matches in registration order, so a status path registered after
    // /designs/:id resolves as a design whose id is "print-status" and 404s.
    // The same trap /designs/import already sits in front of.
    const res = await mount(stubPrint()).request('/api/v1/designs/print-status')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ available: true })
  })

  it('reports the reason and the remedy when there is no browser', async () => {
    const print = stubPrint({
      async status() { return { available: false, reason: 'no browser', remediation: 'install one' } },
    })
    const res = await mount(print).request('/api/v1/designs/print-status')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ available: false, reason: 'no browser', remediation: 'install one' })
  })

  it('answers unavailable rather than 500 when the module has no print service at all', async () => {
    const res = await mount(undefined).request('/api/v1/designs/print-status')
    expect(res.status).toBe(200)
    expect((await res.json()).available).toBe(false)
  })
})

describe('PNG export', () => {
  it('returns the bytes as an image attachment named after the design', async () => {
    const res = await mount(stubPrint()).request(`/api/v1/designs/${designId}/export/png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-disposition')).toContain('spring-flyer')
    expect(res.headers.get('content-disposition')).toContain('.png')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
  })

  it('404s for an unknown design', async () => {
    const res = await mount(stubPrint()).request('/api/v1/designs/nope/export/png')
    expect(res.status).toBe(404)
  })

  it('404s for an artboard the design does not have', async () => {
    const print = stubPrint({ async png() { throw new PrintTargetError('no artboard named Ghost.dc.html') } })
    const res = await mount(print).request(`/api/v1/designs/${designId}/export/png?file=Ghost.dc.html`)
    expect(res.status).toBe(404)
  })

  it('503s with the remedy when the browser is missing', async () => {
    const print = stubPrint({ async png() { throw new BrowserUnavailableError('nothing', 'install chromium') } })
    const res = await mount(print).request(`/api/v1/designs/${designId}/export/png`)
    expect(res.status).toBe(503)
    expect((await res.json()).remediation).toBe('install chromium')
  })

  it('422s when the artboard would print blank', async () => {
    const print = stubPrint({ async png() { throw new PrintRenderError('Main.dc.html did not render: boom') } })
    const res = await mount(print).request(`/api/v1/designs/${designId}/export/png`)
    expect(res.status).toBe(422)
  })

  it('rejects a scale it cannot honour instead of guessing', async () => {
    const res = await mount(stubPrint()).request(`/api/v1/designs/${designId}/export/png?scale=abc`)
    expect(res.status).toBe(400)
  })
})

describe('PDF export', () => {
  it('exports the whole canvas by default', async () => {
    let asked: any
    const print = stubPrint({ async pdf(_d, o) { asked = o; return PDF } })
    const res = await mount(print).request(`/api/v1/designs/${designId}/export/pdf`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(asked.file).toBeUndefined()
  })

  it('exports one artboard when asked, and names the file after it', async () => {
    let asked: any
    const print = stubPrint({ async pdf(_d, o) { asked = o; return PDF } })
    const res = await mount(print).request(`/api/v1/designs/${designId}/export/pdf?file=Main.dc.html`)
    expect(asked.file).toBe('Main.dc.html')
    expect(res.headers.get('content-disposition')).toContain('spring-flyer-Main')
  })

  it('passes the paper and margin through', async () => {
    let asked: any
    const print = stubPrint({ async pdf(_d, o) { asked = o; return PDF } })
    await mount(print).request(`/api/v1/designs/${designId}/export/pdf?paper=letter&margin=0`)
    expect(asked).toMatchObject({ paper: 'letter', marginMm: 0 })
  })

  it('rejects a paper size it does not have', async () => {
    const res = await mount(stubPrint()).request(`/api/v1/designs/${designId}/export/pdf?paper=foolscap`)
    expect(res.status).toBe(400)
  })

  it('rejects a margin that would push the content off the page', async () => {
    const res = await mount(stubPrint()).request(`/api/v1/designs/${designId}/export/pdf?margin=400`)
    expect(res.status).toBe(400)
  })

  it('503s when the module has no print service', async () => {
    const res = await mount(undefined).request(`/api/v1/designs/${designId}/export/pdf`)
    expect(res.status).toBe(503)
  })
})

describe('download filenames', () => {
  it('strips anything a header cannot carry out of the title-derived name', async () => {
    const nasty = designs.create({ title: 'Report "2026"; rm -rf /', files: { 'Main.dc.html': board() } })
    const res = await mount(stubPrint()).request(`/api/v1/designs/${nasty.id}/export/pdf`)
    const disposition = res.headers.get('content-disposition') ?? ''
    expect(disposition).not.toContain(';rm')
    expect(disposition.match(/filename="([^"]*)"/)?.[1]).toMatch(/^[A-Za-z0-9._-]+$/)
  })
})
