// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { parseVaultFile, serializeVaultFile } from '../../../src/modules/memory/vault/frontmatter.js'
import { extractWikilinks } from '../../../src/modules/memory/vault/wikilink-parser.js'

describe('frontmatter', () => {
  it('parses a vault file', () => {
    const raw = `---
title: Kubernetes Networking
tags: [kubernetes, networking]
tier: semantic
links: [odoo-deployment]
created: 2026-04-02
updated: 2026-04-02
---

# Kubernetes Networking
Some content with [[odoo-deployment]] link.`

    const result = parseVaultFile(raw)
    expect(result.frontmatter.title).toBe('Kubernetes Networking')
    expect(result.frontmatter.tags).toEqual(['kubernetes', 'networking'])
    expect(result.frontmatter.tier).toBe('semantic')
    expect(result.frontmatter.links).toEqual(['odoo-deployment'])
    expect(result.content).toContain('# Kubernetes Networking')
  })

  it('serializes a vault file', () => {
    const output = serializeVaultFile({
      title: 'Test',
      tags: ['test'],
      tier: 'semantic',
      links: [],
      created: '2026-04-02',
      updated: '2026-04-02',
    }, '# Test\nContent here.')

    expect(output).toContain('title: Test')
    expect(output).toContain('# Test')
    expect(output).toContain('Content here.')
  })
})

describe('wikilink-parser', () => {
  it('extracts wikilinks from text', () => {
    const text = 'See [[kubernetes-networking]] and also [[odoo-deployment]] for details.'
    const links = extractWikilinks(text)
    expect(links).toHaveLength(2)
    expect(links[0].targetId).toBe('kubernetes-networking')
    expect(links[1].targetId).toBe('odoo-deployment')
  })

  it('extracts display text from piped links', () => {
    const text = 'Check [[page-id|Custom Display Text]].'
    const links = extractWikilinks(text)
    expect(links).toHaveLength(1)
    expect(links[0].targetId).toBe('page-id')
    expect(links[0].displayText).toBe('Custom Display Text')
  })

  it('returns empty array for no links', () => {
    expect(extractWikilinks('No links here.')).toEqual([])
  })

  it('provides context around the link', () => {
    const text = 'The system uses [[load-balancer]] for ingress traffic.'
    const links = extractWikilinks(text)
    expect(links[0].context).toContain('load-balancer')
  })

  it('parses embed syntax (![[image.png]])', () => {
    const links = extractWikilinks('Here: ![[diagram.png]] inline')
    expect(links).toHaveLength(1)
    expect(links[0].targetId).toBe('diagram.png')
    expect(links[0].kind).toBe('embed')
  })

  it('parses heading anchors ([[note#Installation]])', () => {
    const links = extractWikilinks('See [[guide#Installation]] for setup.')
    expect(links).toHaveLength(1)
    expect(links[0].targetId).toBe('guide')
    expect(links[0].anchor).toBe('Installation')
    expect(links[0].kind).toBe('link')
  })

  it('parses block references ([[note^block-id]])', () => {
    const links = extractWikilinks('Ref: [[notes^para-7]] for context.')
    expect(links).toHaveLength(1)
    expect(links[0].targetId).toBe('notes')
    expect(links[0].blockId).toBe('para-7')
  })

  it('combines heading + alias ([[note#Heading|Display]])', () => {
    const links = extractWikilinks('See [[deploy#OKE|Oracle deployment]].')
    expect(links[0].targetId).toBe('deploy')
    expect(links[0].anchor).toBe('OKE')
    expect(links[0].displayText).toBe('Oracle deployment')
  })

  it('mixes embeds, anchors, and plain links', () => {
    const text = '![[img.png]] plus [[a]] and [[b#sec|disp]] and [[c^block]]'
    const links = extractWikilinks(text)
    expect(links).toHaveLength(4)
    expect(links.map(l => l.targetId)).toEqual(['img.png', 'a', 'b', 'c'])
    expect(links.map(l => l.kind)).toEqual(['embed', 'link', 'link', 'link'])
  })
})
