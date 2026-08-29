// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import type { ElementDefinition } from 'cytoscape'
import type { BoardStage, BoardConversation } from '../../src/web/src/stores/board-store'
import type { RunNode, RunNodeStatus } from '../../src/web/src/stores/run-tree-store'
import {
  activePathIds,
  buildOrchestrationElements,
  buildStageFlowElements,
  cssTripletToColor,
  edgeElementId,
  pickDefaultRun,
  shortRunId,
  stageElementId,
  stageNodeSize,
  topologyKey,
  STAGE_NODE_MAX_PX,
  STAGE_NODE_MIN_PX,
  STAGE_NODE_REF_COUNT,
  type OrchestrationRunSummary,
} from '../../src/web/src/pages/board/board-graph-utils'

function node(nodeId: string, parentId: string | null, over: Partial<RunNode> = {}): RunNode {
  return {
    nodeId,
    parentId,
    kind: parentId === null ? 'root' : 'subagent',
    label: nodeId,
    agentId: null,
    conversationId: null,
    status: 'completed' as RunNodeStatus,
    turn: 0,
    tokens: 0,
    currentTool: null,
    summary: null,
    ...over,
  }
}

function tree(...list: RunNode[]): Record<string, RunNode> {
  return Object.fromEntries(list.map((n) => [n.nodeId, n]))
}

function conv(id: string): BoardConversation {
  return {
    id,
    taskId: id,
    title: id,
    priority: 'normal',
    pinned: false,
    position: 0,
    dueDate: null,
    assignees: [],
    tags: [],
    tokensUsed: 0,
    messageCount: 0,
    status: 'open',
  }
}

function stage(id: string, sortOrder: number, count: number, over: Partial<BoardStage> = {}): BoardStage {
  return {
    id,
    name: `Stage ${id}`,
    color: '#123456',
    sortOrder,
    isClosed: false,
    isFolded: false,
    conversations: Array.from({ length: count }, (_, i) => conv(`${id}-c${i}`)),
    ...over,
  }
}

const idsOf = (elements: ElementDefinition[], group: 'nodes' | 'edges') =>
  elements.filter((e) => e.group === group).map((e) => String(e.data.id))

describe('stageNodeSize', () => {
  it('clamps an empty stage to the minimum', () => {
    expect(stageNodeSize(0)).toBe(STAGE_NODE_MIN_PX)
  })

  it('clamps at the maximum from the reference count upwards', () => {
    expect(stageNodeSize(STAGE_NODE_REF_COUNT)).toBe(STAGE_NODE_MAX_PX)
    expect(stageNodeSize(5_000)).toBe(STAGE_NODE_MAX_PX)
  })

  it('grows monotonically between the bounds', () => {
    const sizes = [1, 2, 4, 8, 12].map(stageNodeSize)
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1])
    expect(sizes[0]).toBeGreaterThanOrEqual(STAGE_NODE_MIN_PX)
    expect(sizes.at(-1)).toBe(STAGE_NODE_MAX_PX)
  })

  it('falls back to the minimum for negative and non-finite counts', () => {
    expect(stageNodeSize(-3)).toBe(STAGE_NODE_MIN_PX)
    expect(stageNodeSize(Number.NaN)).toBe(STAGE_NODE_MIN_PX)
    expect(stageNodeSize(Number.POSITIVE_INFINITY)).toBe(STAGE_NODE_MIN_PX)
  })
})

describe('buildOrchestrationElements', () => {
  it('returns nothing for an empty run', () => {
    expect(buildOrchestrationElements({}, [], {})).toEqual([])
  })

  it('emits one node per run node and a parent→child edge per link', () => {
    const nodes = tree(
      node('root', null),
      node('a', 'root'),
      node('b', 'root'),
      node('a1', 'a'),
    )
    const elements = buildOrchestrationElements(nodes, ['root'], { root: ['a', 'b'], a: ['a1'] })

    expect(idsOf(elements, 'nodes')).toEqual(['root', 'a', 'a1', 'b'])
    expect(idsOf(elements, 'edges')).toEqual([
      edgeElementId('root', 'a'),
      edgeElementId('a', 'a1'),
      edgeElementId('root', 'b'),
    ])
    const edge = elements.find((e) => e.data.id === edgeElementId('a', 'a1'))
    expect(edge?.data.source).toBe('a')
    expect(edge?.data.target).toBe('a1')
  })

  it('carries the label, status and conversation id onto node data', () => {
    const nodes = tree(node('root', null, { label: 'Goal', status: 'running', conversationId: 'c1', turn: 3 }))
    const [root] = buildOrchestrationElements(nodes, ['root'], {})

    expect(root.data).toMatchObject({
      id: 'root',
      label: 'Goal',
      status: 'running',
      conversationId: 'c1',
      turn: 3,
      isRoot: true,
    })
  })

  it('renders a node whose parent is missing as a root, with no dangling edge', () => {
    const nodes = tree(node('orphan', 'ghost'))
    const elements = buildOrchestrationElements(nodes, [], {})

    expect(idsOf(elements, 'nodes')).toEqual(['orphan'])
    expect(idsOf(elements, 'edges')).toEqual([])
    expect(elements[0].data.isRoot).toBe(true)
  })

  it('renders nodes the declared roots never reach', () => {
    const nodes = tree(node('root', null), node('stray', null))
    const elements = buildOrchestrationElements(nodes, ['root'], {})

    expect(idsOf(elements, 'nodes')).toEqual(['root', 'stray'])
  })

  it('ignores root ids that have no node', () => {
    const elements = buildOrchestrationElements(tree(node('root', null)), ['root', 'gone'], {})
    expect(idsOf(elements, 'nodes')).toEqual(['root'])
  })

  it('never emits an id twice when childIds contains a cycle', () => {
    const nodes = tree(node('a', 'b'), node('b', 'a'))
    const elements = buildOrchestrationElements(nodes, ['a'], { a: ['b'], b: ['a'] })

    expect(idsOf(elements, 'nodes')).toEqual(['a', 'b'])
    expect(new Set(idsOf(elements, 'edges')).size).toBe(2)
  })

  it('flags the path from a running node up to the root, and only that path', () => {
    const nodes = tree(
      node('root', null),
      node('a', 'root', { status: 'running' }),
      node('a1', 'a', { status: 'running' }),
      node('b', 'root', { status: 'completed' }),
    )
    const elements = buildOrchestrationElements(nodes, ['root'], { root: ['a', 'b'], a: ['a1'] })
    const active = new Set(
      elements.filter((e) => e.data.onActivePath).map((e) => String(e.data.id)),
    )

    expect(active).toEqual(
      new Set(['root', 'a', 'a1', edgeElementId('root', 'a'), edgeElementId('a', 'a1')]),
    )
    expect(elements.find((e) => e.data.id === 'a1')?.classes).toBe('active-path')
    expect(elements.find((e) => e.data.id === 'b')?.classes).toBe('')
  })
})

describe('activePathIds', () => {
  it('is empty when nothing is running', () => {
    expect(activePathIds(tree(node('root', null), node('a', 'root')))).toEqual(new Set())
  })

  it('terminates on a parent cycle', () => {
    const nodes = tree(node('a', 'b', { status: 'running' }), node('b', 'a'))
    expect(activePathIds(nodes)).toEqual(new Set(['a', 'b']))
  })
})

describe('buildStageFlowElements', () => {
  it('returns nothing for a project with no stages', () => {
    expect(buildStageFlowElements([])).toEqual([])
  })

  it('chains the stages in sortOrder regardless of input order', () => {
    const elements = buildStageFlowElements([stage('c', 3, 0), stage('a', 1, 0), stage('b', 2, 0)])

    expect(idsOf(elements, 'nodes')).toEqual([
      stageElementId('a'),
      stageElementId('b'),
      stageElementId('c'),
    ])
    expect(idsOf(elements, 'edges')).toEqual([
      edgeElementId(stageElementId('a'), stageElementId('b')),
      edgeElementId(stageElementId('b'), stageElementId('c')),
    ])
  })

  it('does not mutate the caller stage array', () => {
    const input = [stage('c', 3, 0), stage('a', 1, 0)]
    buildStageFlowElements(input)
    expect(input.map((s) => s.id)).toEqual(['c', 'a'])
  })

  it('derives count, size and color from the stage', () => {
    const [node0] = buildStageFlowElements([stage('a', 1, 4, { color: '#ff0000', name: 'Backlog' })])

    expect(node0.data).toMatchObject({
      id: stageElementId('a'),
      stageId: 'a',
      label: 'Backlog',
      count: 4,
      size: stageNodeSize(4),
      color: '#ff0000',
    })
  })

  it('marks a closed stage', () => {
    const [node0] = buildStageFlowElements([stage('done', 9, 1, { isClosed: true })])
    expect(node0.data.isClosed).toBe(true)
    expect(node0.classes).toBe('stage-closed')
  })

  it('gives a single stage a node and no edge', () => {
    const elements = buildStageFlowElements([stage('only', 1, 2)])
    expect(idsOf(elements, 'nodes')).toHaveLength(1)
    expect(idsOf(elements, 'edges')).toHaveLength(0)
  })
})

describe('topologyKey', () => {
  const base = () =>
    tree(node('root', null), node('a', 'root', { status: 'running', tokens: 10 }))
  const childIds = { root: ['a'] }

  it('is empty for no elements', () => {
    expect(topologyKey([])).toBe('')
  })

  it('is stable across rebuilds of the same topology', () => {
    const first = topologyKey(buildOrchestrationElements(base(), ['root'], childIds))
    const second = topologyKey(buildOrchestrationElements(base(), ['root'], childIds))
    expect(first).toBe(second)
  })

  it('does not change when only status, tokens or the tool tick', () => {
    const before = topologyKey(buildOrchestrationElements(base(), ['root'], childIds))
    const after = topologyKey(
      buildOrchestrationElements(
        tree(
          node('root', null),
          node('a', 'root', { status: 'completed', tokens: 9_999, currentTool: 'Bash' }),
        ),
        ['root'],
        childIds,
      ),
    )
    expect(after).toBe(before)
  })

  it('changes when a node is added', () => {
    const before = topologyKey(buildOrchestrationElements(base(), ['root'], childIds))
    const after = topologyKey(
      buildOrchestrationElements(
        tree(node('root', null), node('a', 'root'), node('b', 'root')),
        ['root'],
        { root: ['a', 'b'] },
      ),
    )
    expect(after).not.toBe(before)
  })

  it('changes when a node is removed', () => {
    const before = topologyKey(buildOrchestrationElements(base(), ['root'], childIds))
    const after = topologyKey(buildOrchestrationElements(tree(node('root', null)), ['root'], {}))
    expect(after).not.toBe(before)
  })

  it('is independent of element order', () => {
    const elements = buildOrchestrationElements(base(), ['root'], childIds)
    expect(topologyKey([...elements].reverse())).toBe(topologyKey(elements))
  })

  it('separates the node and edge namespaces', () => {
    expect(topologyKey([{ group: 'nodes', data: { id: 'x' } }])).toBe('n:x')
    expect(topologyKey([{ group: 'edges', data: { id: 'x', source: 'a', target: 'b' } }])).toBe('e:x')
  })

  it('classifies an edge without an explicit group by its endpoints', () => {
    expect(topologyKey([{ data: { id: 'x', source: 'a', target: 'b' } }])).toBe('e:x')
    expect(topologyKey([{ data: { id: 'x' } }])).toBe('n:x')
  })

  it('tracks the stage flow topology too', () => {
    const before = topologyKey(buildStageFlowElements([stage('a', 1, 1)]))
    // A task moving between stages must not re-run the layout.
    expect(topologyKey(buildStageFlowElements([stage('a', 1, 7)]))).toBe(before)
    expect(topologyKey(buildStageFlowElements([stage('a', 1, 1), stage('b', 2, 0)]))).not.toBe(before)
  })
})

describe('pickDefaultRun', () => {
  function run(
    runId: string,
    status: OrchestrationRunSummary['status'],
    updatedAt: number,
  ): OrchestrationRunSummary {
    return { runId, status, startedAt: updatedAt - 1000, updatedAt, eventCount: 5 }
  }

  it('returns null when there are no runs', () => {
    expect(pickDefaultRun([])).toBeNull()
  })

  it('returns the only run', () => {
    const only = run('r1', 'completed', 100)
    expect(pickDefaultRun([only])).toBe(only)
  })

  it('prefers a running run over a more recently updated finished one', () => {
    const running = run('r-old', 'running', 100)
    const finished = run('r-new', 'completed', 999)
    expect(pickDefaultRun([finished, running])).toBe(running)
  })

  it('picks the freshest of several running runs', () => {
    const stale = run('r-stale', 'running', 100)
    const fresh = run('r-fresh', 'running', 200)
    expect(pickDefaultRun([stale, fresh])).toBe(fresh)
  })

  it('falls back to the latest activity when nothing is running', () => {
    const older = run('r-a', 'failed', 100)
    const newest = run('r-b', 'cancelled', 300)
    const middle = run('r-c', 'completed', 200)
    expect(pickDefaultRun([older, newest, middle])).toBe(newest)
  })

  it('is independent of input order', () => {
    const a = run('a', 'completed', 1)
    const b = run('b', 'running', 2)
    const c = run('c', 'completed', 3)
    expect(pickDefaultRun([a, b, c])).toBe(b)
    expect(pickDefaultRun([c, b, a])).toBe(b)
  })

  it('does not mutate the caller array', () => {
    const input = [run('a', 'completed', 1), run('b', 'completed', 2)]
    pickDefaultRun(input)
    expect(input.map((r) => r.runId)).toEqual(['a', 'b'])
  })
})

describe('shortRunId', () => {
  it('truncates a long id to its first 8 characters', () => {
    expect(shortRunId('0123456789abcdef')).toBe('01234567')
  })

  it('keeps a short id untouched', () => {
    expect(shortRunId('abc')).toBe('abc')
    expect(shortRunId('12345678')).toBe('12345678')
  })

  it('returns an empty string for an empty id', () => {
    expect(shortRunId('')).toBe('')
  })
})

describe('cssTripletToColor', () => {
  it('converts a bare HSL triplet to the comma form cytoscape parses', () => {
    expect(cssTripletToColor('230 10% 50%', '#000')).toBe('hsl(230, 10%, 50%)')
  })

  it('tolerates the padding getPropertyValue returns', () => {
    expect(cssTripletToColor('  0 0% 98%\n', '#000')).toBe('hsl(0, 0%, 98%)')
  })

  it('drops an alpha channel cytoscape cannot read', () => {
    expect(cssTripletToColor('230 10% 50% / 40%', '#000')).toBe('hsl(230, 10%, 50%)')
  })

  it('passes an already-literal color through untouched', () => {
    expect(cssTripletToColor('#ff0000', '#000')).toBe('#ff0000')
    expect(cssTripletToColor('rgb(1, 2, 3)', '#000')).toBe('rgb(1, 2, 3)')
    expect(cssTripletToColor('hsl(1, 2%, 3%)', '#000')).toBe('hsl(1, 2%, 3%)')
  })

  it('falls back when the variable is undefined or unusable', () => {
    expect(cssTripletToColor('', '#abc')).toBe('#abc')
    expect(cssTripletToColor('   ', '#abc')).toBe('#abc')
    expect(cssTripletToColor('0 0%', '#abc')).toBe('#abc')
  })
})
