// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import type { createExtensionManager } from './extension-manager.js'

export interface ExtensionServices {
  manager: ReturnType<typeof createExtensionManager>
}

export function createExtensionRoutes(app: Hono, services: ExtensionServices) {
  const api = new Hono()

  // List available extensions from registry (with install status)
  api.get('/extensions', requirePermission('read', 'Extension'), (c) => {
    const available = services.manager.listAvailable()
    const installed = services.manager.listInstalled()
    const autoInstall = available.filter(e => e.installType === 'auto')
    const manualInstall = available.filter(e => e.installType === 'manual')
    return c.json({
      pageInfo: {
        title: { en: 'Extensions', hu: 'Bővítmények' },
        description: {
          en: 'Some tools and skill packs could not be bundled with EYAS due to licensing restrictions. You can install them here — auto-install packs are downloaded by EYAS with your consent, while third-party tools must be downloaded independently from their original source under their respective licenses.',
          hu: 'Egyes eszközök és skill csomagok licencelési okok miatt nem kerülhettek be az EYAS-ba. Itt telepítheted őket — az automatikus csomagokat az EYAS tölti le a jóváhagyásoddal, a harmadik féltől származó eszközöket pedig az eredeti forrásukból kell letöltened, az adott licence feltételei szerint.',
        },
      },
      extensions: { auto: autoInstall, manual: manualInstall },
      installed,
    })
  })

  // Get single extension details
  api.get('/extensions/:id', requirePermission('read', 'Extension'), (c) => {
    const id = c.req.param('id')
    const available = services.manager.listAvailable()
    const pack = available.find(p => p.id === id)
    if (!pack) return c.json({ error: 'Extension not found' }, 404)
    const installed = services.manager.getInstalled(id)
    return c.json({ extension: pack, installed })
  })

  // Install extension (requires license acceptance in body)
  api.post('/extensions/:id/install', requirePermission('create', 'Extension'), async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()

    if (!body.licenseAccepted) {
      return c.json({ error: 'License must be explicitly accepted before installation' }, 400)
    }

    // Manual extensions cannot be auto-installed
    const available = services.manager.listAvailable()
    const pack = available.find(p => p.id === id)
    if (pack?.installType === 'manual') {
      return c.json({
        error: 'This extension must be installed manually',
        setupGuide: pack.setupGuide,
        downloadUrl: pack.downloadUrl,
      }, 400)
    }

    const result = await services.manager.install(id)
    if (!result.ok) return c.json({ error: result.error }, 400)
    return c.json({ ok: true, installPath: result.installPath }, 201)
  })

  // Uninstall extension
  api.delete('/extensions/:id', requirePermission('delete', 'Extension'), async (c) => {
    const id = c.req.param('id')
    const result = await services.manager.uninstall(id)
    if (!result.ok) return c.json({ error: result.error }, 400)
    return c.json({ ok: true })
  })

  // Toggle extension enabled/disabled
  api.post('/extensions/:id/toggle', requirePermission('update', 'Extension'), (c) => {
    const id = c.req.param('id')
    const result = services.manager.toggle(id)
    if (!result.ok) return c.json({ error: 'Extension not installed' }, 404)
    return c.json({ ok: true, enabled: result.enabled })
  })

  app.route('/api/v1', api)
}
