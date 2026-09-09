// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Builds an Obsidian-style vault graph:
 *  - hard edges: [[wikilinks]] (resolved)
 *  - soft edges: shared meaningful tags, shared topic clusters from path/title
 *
 * Bulk imports often lack both wikilinks and real tags (only import-job tags),
 * so topic clustering from filenames is essential for a usable graph.
 */

export type GraphEdgeKind = 'wikilink' | 'tag' | 'topic'

export interface GraphBuilderNode {
  id: string
  label: string
  tier: string
  tags: string[]
}

export interface GraphBuilderEdge {
  source: string
  target: string
  context: string | null
  resolved: boolean
  kind: GraphEdgeKind
  weight: number
}

export interface GraphBuilderInput {
  nodes: GraphBuilderNode[]
  /** Raw wikilink rows: source path → list of target ids (as stored) */
  outgoing: Map<string, Array<{ targetId: string; context: string | null }>>
  includeSoftEdges?: boolean
  maxSoftEdges?: number
}

export interface GraphBuilderResult {
  nodes: Array<GraphBuilderNode & { degree: number; topic: string }>
  edges: GraphBuilderEdge[]
  stats: {
    nodeCount: number
    edgeCount: number
    wikilinkCount: number
    tagEdgeCount: number
    topicEdgeCount: number
    orphanCount: number
  }
}

const NOISE_TAG = /^(imported|source:|import-job:|auto-|team-session)/i

const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'note', 'md',
  'semantic', 'procedural', 'projects', 'a', 'an', 'of', 'to', 'in', 'on',
  'is', 'or', 'by', 'at', 'as', 'be', 'it', '01kz1e', // import slug noise
])

/** Infer a topic cluster key from path + title (Obsidian-like grouping signal). */
export function inferTopic(path: string, title: string): string {
  const stem = (path.replace(/\.md$/i, '').split('/').pop() ?? path).toLowerCase()
  const t = (title || stem).toLowerCase()

  if (/^feedback[-_]/.test(stem) || t.startsWith('feedback')) return 'topic:feedback'
  if (/^reference[-_]/.test(stem) || t.startsWith('reference')) return 'topic:reference'
  if (/^project[-_]/.test(stem) || t.startsWith('project')) {
    const m = stem.match(/^project[-_]([a-z0-9]+)/)
    if (m) return `topic:project:${m[1]}`
    return 'topic:project'
  }
  if (stem.startsWith('eyssen') || t.includes('eyssen') || t.includes('l10n')) return 'topic:eyssen'
  if (stem.includes('eyas') || t.includes('eyas')) return 'topic:eyas'
  if (stem.includes('odoo') || t.includes('odoo')) return 'topic:odoo'
  if (stem.includes('flutter') || t.includes('flutter')) return 'topic:flutter'
  if (stem.includes('k8s') || stem.includes('kubernetes') || stem.includes('oke')) return 'topic:k8s'
  if (stem.includes('claude') || t.includes('claude')) return 'topic:claude'
  if (stem.includes('marveen') || t.includes('marveen')) return 'topic:marveen'
  if (stem.includes('ticket') || /#\d{3,}/.test(t)) return 'topic:tickets'
  if (stem.includes('log-') || /^log\s/i.test(t)) return 'topic:logs'
  if (stem.includes('license') || t.includes('license') || t.includes('mpl')) return 'topic:licenses'

  // First 1–2 meaningful tokens of the slug
  const tokens = stem.split(/[-_]+/).filter((x) => x.length >= 3 && !STOP.has(x) && !/^\d+$/.test(x))
  if (tokens.length >= 2) return `topic:${tokens[0]}-${tokens[1]}`
  if (tokens.length === 1) return `topic:${tokens[0]}`
  return 'topic:misc'
}

function extractTokens(path: string, title: string): string[] {
  const raw = `${path} ${title}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  return raw
    .split(/\s+/)
    .filter((x) => x.length >= 4 && !STOP.has(x) && !/^\d+$/.test(x))
    .slice(0, 12)
}

function addSoftEdgesInGroup(
  ids: string[],
  kind: GraphEdgeKind,
  context: string,
  weight: number,
  add: (e: GraphBuilderEdge) => void,
) {
  if (ids.length < 2) return
  // Small groups: near-clique. Large: ring + 2-hop chords (bounded density).
  if (ids.length <= 12) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        add({
          source: ids[i]!,
          target: ids[j]!,
          context,
          resolved: true,
          kind,
          weight,
        })
      }
    }
    return
  }
  // Ring
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i]!
    const b = ids[(i + 1) % ids.length]!
    add({ source: a, target: b, context, resolved: true, kind, weight })
  }
  // Chords every ~sqrt(n) steps for connectivity without O(n²)
  const step = Math.max(2, Math.floor(Math.sqrt(ids.length)))
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i]!
    const b = ids[(i + step) % ids.length]!
    if (a !== b) {
      add({ source: a, target: b, context, resolved: true, kind, weight: weight * 0.7 })
    }
  }
}

export function buildVaultGraph(input: GraphBuilderInput): GraphBuilderResult {
  const includeSoft = input.includeSoftEdges !== false
  const maxSoft = input.maxSoftEdges ?? 1200
  const { nodes } = input

  const files = nodes.map((n) => n.id)
  const basenameIndex = new Map<string, string>()
  const titleIndex = new Map<string, string>()

  for (const n of nodes) {
    const stem = n.id.replace(/\.md$/i, '').split('/').pop() ?? n.id
    const lower = stem.toLowerCase()
    if (!basenameIndex.has(stem)) basenameIndex.set(stem, n.id)
    if (!basenameIndex.has(lower)) basenameIndex.set(lower, n.id)
    basenameIndex.set(lower.replace(/-/g, '_'), n.id)
    basenameIndex.set(lower.replace(/_/g, '-'), n.id)
    if (n.label) titleIndex.set(n.label.toLowerCase(), n.id)
  }

  function resolve(target: string): string | null {
    if (!target) return null
    if (files.includes(target)) return target
    if (basenameIndex.has(target)) return basenameIndex.get(target)!
    const noExt = target.replace(/\.md$/i, '')
    if (basenameIndex.has(noExt)) return basenameIndex.get(noExt)!
    const lower = noExt.toLowerCase()
    if (basenameIndex.has(lower)) return basenameIndex.get(lower)!
    if (basenameIndex.has(lower.replace(/-/g, '_'))) return basenameIndex.get(lower.replace(/-/g, '_'))!
    if (basenameIndex.has(lower.replace(/_/g, '-'))) return basenameIndex.get(lower.replace(/_/g, '-'))!
    if (titleIndex.has(lower)) return titleIndex.get(lower)!
    const leaf = lower.split('/').pop()!
    if (leaf !== lower && basenameIndex.has(leaf)) return basenameIndex.get(leaf)!
    return null
  }

  const edges: GraphBuilderEdge[] = []
  const edgeKeys = new Set<string>()

  function addEdge(e: GraphBuilderEdge) {
    if (e.source === e.target) return
    const undirected = e.kind !== 'wikilink'
    const key = undirected
      ? `${e.kind}:${[e.source, e.target].sort().join('|')}`
      : `wl:${e.source}>${e.target}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push(e)
  }

  // 1) Wikilinks
  for (const [source, outs] of input.outgoing) {
    for (const o of outs) {
      const resolved = resolve(o.targetId)
      addEdge({
        source,
        target: resolved ?? o.targetId,
        context: o.context,
        resolved: resolved !== null,
        kind: 'wikilink',
        weight: 1.5,
      })
    }
  }

  if (includeSoft) {
    const softCandidates: Array<GraphBuilderEdge & { score: number }> = []

    // 2) Real tags (non-noise)
    const tagToNodes = new Map<string, string[]>()
    for (const n of nodes) {
      for (const raw of n.tags) {
        const tag = String(raw).trim()
        if (!tag || tag.length < 2 || NOISE_TAG.test(tag)) continue
        const list = tagToNodes.get(tag) ?? []
        list.push(n.id)
        tagToNodes.set(tag, list)
      }
    }
    for (const [tag, ids] of tagToNodes) {
      if (ids.length < 2 || ids.length > 50) continue
      const score = 1 / ids.length
      if (ids.length <= 12) {
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            softCandidates.push({
              source: ids[i]!,
              target: ids[j]!,
              context: `#${tag}`,
              resolved: true,
              kind: 'tag',
              weight: score,
              score: score + 0.5,
            })
          }
        }
      } else {
        for (let i = 0; i < ids.length; i++) {
          softCandidates.push({
            source: ids[i]!,
            target: ids[(i + 1) % ids.length]!,
            context: `#${tag}`,
            resolved: true,
            kind: 'tag',
            weight: score,
            score,
          })
        }
      }
    }

    // 3) Topic clusters from path/title
    const topicToNodes = new Map<string, string[]>()
    const topics = new Map<string, string>()
    for (const n of nodes) {
      const topic = inferTopic(n.id, n.label)
      topics.set(n.id, topic)
      const list = topicToNodes.get(topic) ?? []
      list.push(n.id)
      topicToNodes.set(topic, list)
    }
    for (const [topic, ids] of topicToNodes) {
      if (ids.length < 2) continue
      if (topic === 'topic:misc' && ids.length > 30) continue // too noisy
      const weight = Math.min(0.9, 0.35 + 1 / ids.length)
      // collect as soft candidates via temporary set
      const before = softCandidates.length
      if (ids.length <= 12) {
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            softCandidates.push({
              source: ids[i]!,
              target: ids[j]!,
              context: topic,
              resolved: true,
              kind: 'topic',
              weight,
              score: weight + 0.3,
            })
          }
        }
      } else {
        const step = Math.max(2, Math.floor(Math.sqrt(ids.length)))
        for (let i = 0; i < ids.length; i++) {
          softCandidates.push({
            source: ids[i]!,
            target: ids[(i + 1) % ids.length]!,
            context: topic,
            resolved: true,
            kind: 'topic',
            weight,
            score: weight,
          })
          softCandidates.push({
            source: ids[i]!,
            target: ids[(i + step) % ids.length]!,
            context: topic,
            resolved: true,
            kind: 'topic',
            weight: weight * 0.7,
            score: weight * 0.7,
          })
        }
      }
      void before
    }

    // 4) Shared significant tokens (secondary)
    const tokenToNodes = new Map<string, string[]>()
    for (const n of nodes) {
      for (const tok of extractTokens(n.id, n.label)) {
        const list = tokenToNodes.get(tok) ?? []
        if (list.length < 40) list.push(n.id)
        tokenToNodes.set(tok, list)
      }
    }
    for (const [tok, ids] of tokenToNodes) {
      if (ids.length < 3 || ids.length > 25) continue
      const uniq = [...new Set(ids)]
      if (uniq.length < 3) continue
      const weight = 0.2
      for (let i = 0; i < uniq.length; i++) {
        softCandidates.push({
          source: uniq[i]!,
          target: uniq[(i + 1) % uniq.length]!,
          context: `token:${tok}`,
          resolved: true,
          kind: 'topic',
          weight,
          score: weight,
        })
      }
    }

    softCandidates.sort((a, b) => b.score - a.score)
    let added = 0
    for (const sc of softCandidates) {
      if (added >= maxSoft) break
      const before = edgeKeys.size
      addEdge(sc)
      if (edgeKeys.size > before) added++
    }

    // Attach topic on nodes
    void topics
  }

  const topicsFinal = new Map<string, string>()
  for (const n of nodes) {
    topicsFinal.set(n.id, inferTopic(n.id, n.label))
  }

  const degree = new Map<string, number>()
  for (const n of nodes) degree.set(n.id, 0)
  for (const e of edges) {
    // only count resolved targets that are real nodes
    if (degree.has(e.source)) degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    if (degree.has(e.target)) degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }

  const nodesOut = nodes.map((n) => ({
    ...n,
    degree: degree.get(n.id) ?? 0,
    topic: topicsFinal.get(n.id) ?? 'topic:misc',
  }))

  return {
    nodes: nodesOut,
    edges,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      wikilinkCount: edges.filter((e) => e.kind === 'wikilink').length,
      tagEdgeCount: edges.filter((e) => e.kind === 'tag').length,
      topicEdgeCount: edges.filter((e) => e.kind === 'topic').length,
      orphanCount: nodesOut.filter((n) => n.degree === 0).length,
    },
  }
}

// silence unused in case tree-shake
void addSoftEdgesInGroup
