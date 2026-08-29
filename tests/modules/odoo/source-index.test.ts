// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  searchOdooModels,
  searchOdooFields,
  searchOdooXmlIds,
} from '@modules/odoo/source-index'

describe('odoo source-index', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eyas-odoo-src-'))
    const models = join(root, 'addons', 'sale', 'models')
    mkdirSync(models, { recursive: true })
    writeFileSync(
      join(models, 'sale_order.py'),
      `
from odoo import models, fields

class SaleOrder(models.Model):
    _name = 'sale.order'
    _description = 'Sales Order'

    partner_id = fields.Many2one('res.partner', string='Customer')
    amount_total = fields.Monetary()
`,
    )
    const data = join(root, 'addons', 'sale', 'data')
    mkdirSync(data, { recursive: true })
    writeFileSync(
      join(data, 'ir_sequence_data.xml'),
      `<?xml version="1.0"?>
<odoo>
  <record id="seq_sale_order" model="ir.sequence">
    <field name="name">Sales Order</field>
  </record>
</odoo>
`,
    )
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('finds models by _name', async () => {
    const hits = await searchOdooModels([root], 'sale.order')
    expect(hits.some((h) => h.model === 'sale.order' && h.kind === 'model')).toBe(true)
  })

  it('finds fields', async () => {
    const hits = await searchOdooFields([root], 'partner_id')
    expect(hits.some((h) => h.field === 'partner_id' && h.fieldType === 'Many2one')).toBe(true)
  })

  it('finds xml ids', async () => {
    const hits = await searchOdooXmlIds([root], 'seq_sale')
    expect(hits.some((h) => h.xmlId === 'seq_sale_order')).toBe(true)
  })
})
