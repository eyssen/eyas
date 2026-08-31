// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildVaultGraph, inferTopic } from '@modules/memory/vault/graph-builder'

describe('graph-builder', () => {
  it('infers topics from path/title', () => {
    expect(inferTopic('semantic/feedback-no-studio.md', 'No Studio')).toBe('topic:feedback')
    expect(inferTopic('semantic/project_maxvalor_ticket1149.md', 'Maxvalor')).toBe(
      'topic:project:maxvalor',
    )
    expect(inferTopic('semantic/eyssen-l10n-hu.md', 'l10n')).toBe('topic:eyssen')
  })

  it('builds soft topic edges when tags are only import noise', () => {
    const nodes = [
      { id: 'semantic/feedback-a.md', label: 'Feedback A', tier: 'semantic', tags: ['imported', 'source:x'] },
      { id: 'semantic/feedback-b.md', label: 'Feedback B', tier: 'semantic', tags: ['imported'] },
      { id: 'semantic/feedback-c.md', label: 'Feedback C', tier: 'semantic', tags: ['imported'] },
      { id: 'semantic/eyssen-foo.md', label: 'eYssen Foo', tier: 'semantic', tags: ['imported'] },
      { id: 'semantic/eyssen-bar.md', label: 'eYssen Bar', tier: 'semantic', tags: ['imported'] },
      { id: 'semantic/lonely.md', label: 'Lonely', tier: 'semantic', tags: ['imported'] },
    ]
    const graph = buildVaultGraph({
      nodes,
      outgoing: new Map(),
      includeSoftEdges: true,
    })
    expect(graph.stats.topicEdgeCount).toBeGreaterThan(0)
    expect(graph.stats.wikilinkCount).toBe(0)
    // feedback trio should be connected
    const feedbackEdges = graph.edges.filter((e) => e.context === 'topic:feedback')
    expect(feedbackEdges.length).toBeGreaterThanOrEqual(3)
    // lonely may still be orphan
    const lonely = graph.nodes.find((n) => n.id.endsWith('lonely.md'))
    expect(lonely?.degree).toBe(0)
  })

  it('resolves wikilinks with underscore/hyphen variants', () => {
    const nodes = [
      {
        id: 'semantic/eyssen-erp-repo-location.md',
        label: 'Repo location',
        tier: 'semantic',
        tags: [],
      },
      {
        id: 'semantic/hitspace.md',
        label: 'Hitspace',
        tier: 'semantic',
        tags: [],
      },
    ]
    const outgoing = new Map([
      [
        'semantic/hitspace.md',
        [{ targetId: 'eyssen_erp_repo_location', context: 'see [[eyssen_erp_repo_location]]' }],
      ],
    ])
    const graph = buildVaultGraph({ nodes, outgoing, includeSoftEdges: false })
    const wl = graph.edges.find((e) => e.kind === 'wikilink')
    expect(wl?.resolved).toBe(true)
    expect(wl?.target).toBe('semantic/eyssen-erp-repo-location.md')
  })
})
