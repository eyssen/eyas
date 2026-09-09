// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { buildFlow, defineNode, FlowBuildError } from '@modules/agent/flow'

/**
 * Phase 3G — Flow runner tests.
 *
 * Locks in the three invariants callers depend on:
 *   1. Structural validity (cycles, dangling edges) caught at build time.
 *   2. Zod schemas enforced at every node boundary.
 *   3. Topological order stable w.r.t. declaration order when ties allow.
 */

describe('buildFlow — structure validation', () => {
  const nop = (id: string) =>
    defineNode({
      id,
      inputSchema: z.any(),
      outputSchema: z.any(),
      async execute() { return null },
    })

  it('rejects duplicate node ids', () => {
    expect(() =>
      buildFlow({
        id: 'f1',
        name: 'dup',
        nodes: [nop('a'), nop('a')],
        edges: [],
      }),
    ).toThrow(FlowBuildError)
  })

  it('rejects edges pointing to unknown targets', () => {
    expect(() =>
      buildFlow({
        id: 'f2',
        name: 'dangling',
        nodes: [nop('a')],
        edges: [{ from: 'a', to: 'ghost' }],
      }),
    ).toThrow(/unknown target/)
  })

  it('rejects self-loops', () => {
    expect(() =>
      buildFlow({
        id: 'f3',
        name: 'selfloop',
        nodes: [nop('a')],
        edges: [{ from: 'a', to: 'a' }],
      }),
    ).toThrow(/self-loop/)
  })

  it('rejects cycles and names the involved nodes', () => {
    expect(() =>
      buildFlow({
        id: 'f4',
        name: 'cycle',
        nodes: [nop('a'), nop('b'), nop('c')],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
          { from: 'c', to: 'a' },
        ],
      }),
    ).toThrow(/cycle detected/)
  })

  it('rejects empty flows', () => {
    expect(() =>
      buildFlow({ id: 'f5', name: 'empty', nodes: [], edges: [] }),
    ).toThrow(/no nodes/)
  })
})

describe('buildFlow — execution order', () => {
  const nop = (id: string) =>
    defineNode({
      id,
      inputSchema: z.any(),
      outputSchema: z.any(),
      async execute() { return id },
    })

  it('runs nodes in topological order', () => {
    const flow = buildFlow({
      id: 'f',
      name: 'linear',
      nodes: [nop('c'), nop('a'), nop('b')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    })
    expect(flow.executionOrder).toEqual(['a', 'b', 'c'])
  })

  it('uses declaration order to break topological ties', () => {
    // b and c both depend on a; declaration order b → c must be preserved.
    const flow = buildFlow({
      id: 'f',
      name: 'ties',
      nodes: [nop('a'), nop('b'), nop('c')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ],
    })
    expect(flow.executionOrder).toEqual(['a', 'b', 'c'])
  })
})

describe('buildFlow — runtime', () => {
  it('passes single-inbound output directly to the next node', async () => {
    const flow = buildFlow({
      id: 'f',
      name: 'linear',
      entrySchema: z.number(),
      nodes: [
        defineNode({
          id: 'double',
          inputSchema: z.number(),
          outputSchema: z.number(),
          async execute(x) { return x * 2 },
        }),
        defineNode({
          id: 'plus-one',
          inputSchema: z.number(),
          outputSchema: z.number(),
          async execute(x) { return x + 1 },
        }),
      ],
      edges: [{ from: 'double', to: 'plus-one' }],
    })

    const res = await flow.run(3)
    expect(res.status).toBe('success')
    expect(res.outputs['double']).toBe(6)
    expect(res.outputs['plus-one']).toBe(7)
  })

  it('fan-in: default assembly passes a record keyed by source id', async () => {
    const flow = buildFlow({
      id: 'f',
      name: 'fanin',
      entrySchema: z.number(),
      nodes: [
        defineNode({
          id: 'x',
          inputSchema: z.number(),
          outputSchema: z.number(),
          async execute(n) { return n + 10 },
        }),
        defineNode({
          id: 'y',
          inputSchema: z.number(),
          outputSchema: z.number(),
          async execute(n) { return n + 20 },
        }),
        defineNode({
          id: 'sum',
          inputSchema: z.object({ x: z.number(), y: z.number() }),
          outputSchema: z.number(),
          async execute({ x, y }) { return x + y },
        }),
      ],
      edges: [
        { from: 'x', to: 'sum' },
        { from: 'y', to: 'sum' },
      ],
    })

    const res = await flow.run(1)
    expect(res.status).toBe('success')
    expect(res.outputs['sum']).toBe(32) // (1+10) + (1+20)
  })

  it('custom edge.map is the explicit override for input assembly', async () => {
    const flow = buildFlow({
      id: 'f',
      name: 'map',
      entrySchema: z.number(),
      nodes: [
        defineNode({
          id: 'a',
          inputSchema: z.number(),
          outputSchema: z.object({ value: z.number() }),
          async execute(n) { return { value: n * 100 } },
        }),
        defineNode({
          id: 'b',
          inputSchema: z.number(),
          outputSchema: z.number(),
          async execute(n) { return n },
        }),
      ],
      edges: [{
        from: 'a',
        to: 'b',
        // Extract the inner .value field instead of passing the whole object.
        map: outputs => (outputs['a'] as { value: number }).value,
      }],
    })

    const res = await flow.run(2)
    expect(res.status).toBe('success')
    expect(res.outputs['b']).toBe(200)
  })

  it('edge.when skips the edge when predicate returns false', async () => {
    const flow = buildFlow({
      id: 'f',
      name: 'conditional',
      entrySchema: z.number(),
      nodes: [
        defineNode({
          id: 'source',
          inputSchema: z.number(),
          outputSchema: z.number(),
          async execute(n) { return n },
        }),
        defineNode({
          id: 'only-positive',
          inputSchema: z.number(),
          outputSchema: z.number(),
          async execute(n) { return n * 10 },
        }),
      ],
      edges: [{
        from: 'source',
        to: 'only-positive',
        when: outputs => (outputs['source'] as number) > 0,
      }],
    })

    const neg = await flow.run(-5)
    expect(neg.status).toBe('success')
    // Downstream node was skipped because the edge guard returned false.
    expect(neg.outputs['only-positive']).toBeUndefined()

    const pos = await flow.run(5)
    expect(pos.outputs['only-positive']).toBe(50)
  })

  it('input schema violation halts the flow with a failed status', async () => {
    const flow = buildFlow({
      id: 'f',
      name: 'bad-input',
      entrySchema: z.number(),
      nodes: [
        defineNode({
          id: 'needs-string',
          inputSchema: z.string(),
          outputSchema: z.string(),
          async execute(s) { return s.toUpperCase() },
        }),
      ],
      edges: [],
    })

    const res = await flow.run(42)
    expect(res.status).toBe('failed')
    expect(res.errors[0]).toMatchObject({
      nodeId: 'needs-string',
      phase: 'input-validation',
    })
  })

  it('output schema violation halts the flow before downstream runs', async () => {
    let downstreamRan = false
    const flow = buildFlow({
      id: 'f',
      name: 'bad-output',
      entrySchema: z.any(),
      nodes: [
        defineNode({
          id: 'liar',
          inputSchema: z.any(),
          outputSchema: z.string(),
          // declared string but returns a number — schema violation
          async execute() { return 42 as unknown as string },
        }),
        defineNode({
          id: 'victim',
          inputSchema: z.any(),
          outputSchema: z.any(),
          async execute() {
            downstreamRan = true
            return null
          },
        }),
      ],
      edges: [{ from: 'liar', to: 'victim' }],
    })

    const res = await flow.run(null)
    expect(res.status).toBe('failed')
    expect(res.errors[0].phase).toBe('output-validation')
    expect(downstreamRan).toBe(false)
  })

  it('execute-time exception is captured as a failure, not an uncaught throw', async () => {
    const flow = buildFlow({
      id: 'f',
      name: 'bomb',
      entrySchema: z.any(),
      nodes: [
        defineNode({
          id: 'boom',
          inputSchema: z.any(),
          outputSchema: z.any(),
          async execute() { throw new Error('detonated') },
        }),
      ],
      edges: [],
    })

    const res = await flow.run(null)
    expect(res.status).toBe('failed')
    expect(res.errors[0].phase).toBe('execute')
    expect(res.errors[0].message).toContain('detonated')
  })

  it('AbortSignal stops the flow between node boundaries', async () => {
    const controller = new AbortController()
    let ran: string[] = []

    const flow = buildFlow({
      id: 'f',
      name: 'abortable',
      entrySchema: z.any(),
      nodes: [
        defineNode({
          id: 'first',
          inputSchema: z.any(),
          outputSchema: z.any(),
          async execute() {
            ran.push('first')
            controller.abort()
            return 'ok'
          },
        }),
        defineNode({
          id: 'never',
          inputSchema: z.any(),
          outputSchema: z.any(),
          async execute() {
            ran.push('never')
            return null
          },
        }),
      ],
      edges: [{ from: 'first', to: 'never' }],
    })

    const res = await flow.run(null, { signal: controller.signal })
    expect(res.status).toBe('aborted')
    expect(ran).toEqual(['first'])
  })

  it('entrySchema failure is surfaced as an entry-input validation error', async () => {
    const flow = buildFlow({
      id: 'f',
      name: 'entry-guard',
      entrySchema: z.object({ id: z.string() }),
      nodes: [
        defineNode({
          id: 'pass',
          inputSchema: z.any(),
          outputSchema: z.any(),
          async execute() { return null },
        }),
      ],
      edges: [],
    })

    const res = await flow.run({ id: 42 })
    expect(res.status).toBe('failed')
    expect(res.errors[0].nodeId).toBe('__entry__')
    expect(res.errors[0].phase).toBe('input-validation')
  })

  it('returns the topological order used for the run', async () => {
    const flow = buildFlow({
      id: 'f',
      name: 'linear',
      entrySchema: z.any(),
      nodes: [
        defineNode({ id: 'a', inputSchema: z.any(), outputSchema: z.any(), async execute() { return 'a' } }),
        defineNode({ id: 'b', inputSchema: z.any(), outputSchema: z.any(), async execute() { return 'b' } }),
      ],
      edges: [{ from: 'a', to: 'b' }],
    })

    const res = await flow.run(null)
    expect(res.executionOrder).toEqual(['a', 'b'])
  })
})
