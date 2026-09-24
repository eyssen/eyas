// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z, type ZodTypeAny } from 'zod'
import type { Logger } from 'pino'
import { generateId } from '@shared/crypto.js'

/**
 * Flow vs Crew — Phase 3G.
 *
 * Inspired by CrewAI's dichotomy: some problems are best solved by a
 * deterministic, auditable DAG (a "Flow"); others need open-ended
 * collaboration between agents (a "Crew"). EYAS already ships crews via
 * Team Sessions — this module adds the Flow half.
 *
 * A Flow is:
 *   - a set of typed nodes (each with Zod-validated input + output)
 *   - a set of edges that describe how each node's input is assembled from
 *     upstream outputs
 *   - a topological execution order computed once at run-start
 *
 * Guarantees:
 *   - Cycle detection at build time — cycles are programming errors,
 *     NOT runtime surprises.
 *   - Input/output schema enforcement at every node boundary — Zod parse
 *     failures stop the flow with a clear error instead of corrupting
 *     downstream state.
 *   - Deterministic order: nodes run in a stable topological sort, with
 *     siblings executed in insertion order (not parallel). Parallel-safe
 *     nodes can be marked `parallel: true` in a future iteration — we keep
 *     the first cut sequential for easier reasoning.
 *   - Abort-safe: an AbortSignal stops the run between node boundaries.
 *
 * Non-goals (for v1):
 *   - Per-node retry logic (use a wrapping node if needed)
 *   - Parallel sibling execution
 *   - Persistent checkpointing (event-store captures runs externally)
 */

export interface FlowContext {
  flowRunId: string
  logger?: Logger
  signal?: AbortSignal
}

export interface FlowNode<InputT = unknown, OutputT = unknown> {
  id: string
  name?: string
  inputSchema: z.ZodType<InputT>
  outputSchema: z.ZodType<OutputT>
  /**
   * Execute the node. Must be pure enough that the same input always yields
   * the same output within one flow run — external side effects are allowed
   * but should be idempotent so a re-run doesn't corrupt external state.
   */
  execute(input: InputT, ctx: FlowContext): Promise<OutputT>
}

/**
 * Default mapping strategy: the target node receives an object keyed by
 * upstream source node id. When a node has exactly one inbound edge and no
 * `map` override, the target receives the upstream output directly (the
 * common case — a linear pipeline).
 */
export type FlowEdgeMap = (outputs: Record<string, unknown>) => unknown

export interface FlowEdge {
  from: string
  to: string
  /** Build the target's input from the (source-id → output) map. */
  map?: FlowEdgeMap
  /** Skip this edge entirely if the predicate returns false. */
  when?: (outputs: Record<string, unknown>) => boolean
}

export interface FlowDefinition {
  id: string
  name: string
  /** Input fed into every entry node (nodes with no inbound edges). */
  entrySchema?: ZodTypeAny
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export type FlowRunStatus = 'success' | 'failed' | 'aborted'

export interface FlowRunError {
  nodeId: string
  phase: 'input-validation' | 'execute' | 'output-validation'
  message: string
}

export interface FlowRunResult {
  flowRunId: string
  flowId: string
  status: FlowRunStatus
  /** Per-node output, keyed by node id. Omitted for nodes that never ran. */
  outputs: Record<string, unknown>
  errors: FlowRunError[]
  startedAt: number
  endedAt: number
  /** Topological order used for this run — useful for audit trails. */
  executionOrder: string[]
}

export class FlowBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowBuildError'
  }
}

/**
 * Build & validate a flow definition. Throws FlowBuildError for structural
 * problems (cycles, dangling edges, duplicate node ids). Returns a handle
 * whose `run()` method executes the flow end-to-end.
 */
export function buildFlow(definition: FlowDefinition): {
  definition: FlowDefinition
  executionOrder: string[]
  run(input: unknown, ctx?: Partial<FlowContext>): Promise<FlowRunResult>
} {
  validateStructure(definition)
  const executionOrder = topoSort(definition)

  return {
    definition,
    executionOrder,
    async run(initialInput, ctxOverrides) {
      const flowRunId = ctxOverrides?.flowRunId ?? `flow-${generateId()}`
      const ctx: FlowContext = {
        flowRunId,
        logger: ctxOverrides?.logger,
        signal: ctxOverrides?.signal,
      }

      const startedAt = Date.now()
      const outputs: Record<string, unknown> = {}
      const errors: FlowRunError[] = []

      // Validate the initial input once, if an entry schema is declared.
      if (definition.entrySchema) {
        const parsed = definition.entrySchema.safeParse(initialInput)
        if (!parsed.success) {
          return {
            flowRunId,
            flowId: definition.id,
            status: 'failed',
            outputs,
            errors: [{
              nodeId: '__entry__',
              phase: 'input-validation',
              message: `entry input failed schema: ${parsed.error.message}`,
            }],
            startedAt,
            endedAt: Date.now(),
            executionOrder,
          }
        }
        initialInput = parsed.data
      }

      const nodesById = new Map(definition.nodes.map(n => [n.id, n]))
      const inboundByTarget = new Map<string, FlowEdge[]>()
      for (const edge of definition.edges) {
        const list = inboundByTarget.get(edge.to) ?? []
        list.push(edge)
        inboundByTarget.set(edge.to, list)
      }

      for (const nodeId of executionOrder) {
        if (ctx.signal?.aborted) {
          return {
            flowRunId,
            flowId: definition.id,
            status: 'aborted',
            outputs,
            errors,
            startedAt,
            endedAt: Date.now(),
            executionOrder,
          }
        }

        const node = nodesById.get(nodeId)!
        const inboundEdges = inboundByTarget.get(nodeId) ?? []

        // Assemble input.
        let nodeInput: unknown
        if (inboundEdges.length === 0) {
          // Entry node — use the initial flow input.
          nodeInput = initialInput
        } else {
          const reachableEdges = inboundEdges.filter(e => !e.when || e.when(outputs))
          if (reachableEdges.length === 0) {
            // Every inbound edge was guarded off — treat the node as skipped.
            // Downstream nodes that depend on this one will see its absence in
            // the outputs map and can react accordingly.
            continue
          }
          nodeInput = assembleInput(node.id, reachableEdges, outputs)
        }

        // Input schema check.
        const inputParse = node.inputSchema.safeParse(nodeInput)
        if (!inputParse.success) {
          errors.push({
            nodeId,
            phase: 'input-validation',
            message: inputParse.error.message,
          })
          return {
            flowRunId,
            flowId: definition.id,
            status: 'failed',
            outputs,
            errors,
            startedAt,
            endedAt: Date.now(),
            executionOrder,
          }
        }

        // Execute.
        let rawOutput: unknown
        try {
          rawOutput = await node.execute(inputParse.data as never, ctx)
        } catch (err) {
          errors.push({
            nodeId,
            phase: 'execute',
            message: err instanceof Error ? err.message : String(err),
          })
          return {
            flowRunId,
            flowId: definition.id,
            status: 'failed',
            outputs,
            errors,
            startedAt,
            endedAt: Date.now(),
            executionOrder,
          }
        }

        // Output schema check.
        const outputParse = node.outputSchema.safeParse(rawOutput)
        if (!outputParse.success) {
          errors.push({
            nodeId,
            phase: 'output-validation',
            message: outputParse.error.message,
          })
          return {
            flowRunId,
            flowId: definition.id,
            status: 'failed',
            outputs,
            errors,
            startedAt,
            endedAt: Date.now(),
            executionOrder,
          }
        }

        outputs[nodeId] = outputParse.data
      }

      return {
        flowRunId,
        flowId: definition.id,
        status: 'success',
        outputs,
        errors,
        startedAt,
        endedAt: Date.now(),
        executionOrder,
      }
    },
  }
}

function assembleInput(
  targetId: string,
  inboundEdges: FlowEdge[],
  outputs: Record<string, unknown>,
): unknown {
  // If the first edge has a map, use the map exclusively — map is the explicit
  // "I want full control over how inputs are built" escape hatch.
  const mapped = inboundEdges.find(e => e.map)
  if (mapped?.map) return mapped.map(outputs)

  // Single-inbound linear case: pass the upstream output straight through.
  if (inboundEdges.length === 1) {
    return outputs[inboundEdges[0].from]
  }

  // Fan-in with no map: produce an object keyed by source id.
  const collected: Record<string, unknown> = {}
  for (const edge of inboundEdges) {
    collected[edge.from] = outputs[edge.from]
  }
  return collected
}

function validateStructure(def: FlowDefinition): void {
  if (def.nodes.length === 0) {
    throw new FlowBuildError(`flow ${def.id} has no nodes`)
  }

  const nodeIds = new Set<string>()
  for (const node of def.nodes) {
    if (nodeIds.has(node.id)) {
      throw new FlowBuildError(`duplicate node id in flow ${def.id}: ${node.id}`)
    }
    nodeIds.add(node.id)
  }

  for (const edge of def.edges) {
    if (!nodeIds.has(edge.from)) {
      throw new FlowBuildError(`edge references unknown source node: ${edge.from}`)
    }
    if (!nodeIds.has(edge.to)) {
      throw new FlowBuildError(`edge references unknown target node: ${edge.to}`)
    }
    if (edge.from === edge.to) {
      throw new FlowBuildError(`self-loop edge on node ${edge.from} is not allowed`)
    }
  }
}

function topoSort(def: FlowDefinition): string[] {
  // Kahn's algorithm — O(V + E), stable with respect to node insertion order
  // when we break ties by the original ordering. Stability matters because
  // flow authors expect declaration order to survive when the DAG allows it.
  const nodeOrder = new Map(def.nodes.map((n, i) => [n.id, i]))
  const indegree = new Map<string, number>()
  const outEdges = new Map<string, string[]>()

  for (const node of def.nodes) {
    indegree.set(node.id, 0)
    outEdges.set(node.id, [])
  }
  for (const edge of def.edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
    outEdges.get(edge.from)!.push(edge.to)
  }

  // Ready set: nodes with zero remaining in-edges. Sorted by declaration order
  // on each pick to keep the output stable.
  const ready: string[] = []
  for (const node of def.nodes) {
    if (indegree.get(node.id) === 0) ready.push(node.id)
  }

  const result: string[] = []
  while (ready.length > 0) {
    ready.sort((a, b) => (nodeOrder.get(a)! - nodeOrder.get(b)!))
    const next = ready.shift()!
    result.push(next)
    for (const successor of outEdges.get(next)!) {
      const nextIndeg = (indegree.get(successor) ?? 0) - 1
      indegree.set(successor, nextIndeg)
      if (nextIndeg === 0) ready.push(successor)
    }
  }

  if (result.length !== def.nodes.length) {
    const cycleNodes = def.nodes
      .filter(n => (indegree.get(n.id) ?? 0) > 0)
      .map(n => n.id)
    throw new FlowBuildError(
      `cycle detected in flow ${def.id} — nodes involved: ${cycleNodes.join(', ')}`,
    )
  }
  return result
}

/**
 * Type-helper constructor for defining a node concisely while preserving
 * input/output inference. The plain FlowNode<InputT, OutputT> is fine too;
 * this just lets call sites skip the type arguments when using Zod inference.
 */
export function defineNode<InputSchema extends ZodTypeAny, OutputSchema extends ZodTypeAny>(
  spec: {
    id: string
    name?: string
    inputSchema: InputSchema
    outputSchema: OutputSchema
    execute: (
      input: z.infer<InputSchema>,
      ctx: FlowContext,
    ) => Promise<z.infer<OutputSchema>>
  },
): FlowNode<z.infer<InputSchema>, z.infer<OutputSchema>> {
  return spec as unknown as FlowNode<z.infer<InputSchema>, z.infer<OutputSchema>>
}
