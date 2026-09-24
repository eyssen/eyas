// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PipelineDeps } from '../port-types.js'
import type { StageContext, StageResult } from '../types.js'

/**
 * Stage 3 — Architect Design.
 *
 * Consumes the PRD and produces a DesignDoc with components, data flow,
 * interfaces and data model sketches. Fails fast if the previous
 * artifact is missing or the agent output is unusable.
 */
export async function runArchitectDesignStage(
  deps: PipelineDeps,
  ctx: StageContext,
): Promise<StageResult> {
  if (!ctx.previousArtifactId) {
    throw new Error('architect-design requires a PRD artifact')
  }

  const prd = deps.artifacts.getWithPayload(ctx.previousArtifactId)
  if (!prd) {
    throw new Error(`PRD artifact ${ctx.previousArtifactId} not found`)
  }

  const agentId = ctx.config.agentIds?.['architect-design'] ?? 'architect'
  const output = await deps.agentRunner.run({
    agentId,
    sessionId: ctx.sessionId,
    instructions:
      'You are the Architect. Given the PRD, produce a DesignDoc as JSON: ' +
      'summary, architecture.components (>=1, each with name+responsibility), ' +
      'architecture.dataFlow, interfaces, dataModel, risks, alternatives.',
    context: { prd: prd.payload },
  })

  const payload = coerceDesignDoc(output.json)
  const artifact = deps.artifacts.create({
    sessionId: ctx.sessionId,
    kind: 'design-doc',
    title: `DesignDoc for ${ctx.runId}`.slice(0, 200),
    payload,
    producedBy: `agent:${agentId}`,
    changeNote: 'Architect design',
  })

  try {
    deps.artifacts.link(artifact.id, ctx.previousArtifactId, 'derives_from')
  } catch (err) {
    deps.logger?.warn?.('architect-design link failed', err)
  }

  return {
    artifactId: artifact.id,
    summary: `DesignDoc with ${payload.architecture.components.length} components`,
    metadata: {
      agentId,
      componentCount: payload.architecture.components.length,
      interfaceCount: payload.interfaces.length,
    },
  }
}

function coerceDesignDoc(json: unknown): {
  summary: string
  architecture: {
    components: Array<{ name: string; responsibility: string }>
    dataFlow: string[]
  }
  interfaces: Array<{ name: string; kind: 'http' | 'event' | 'function' | 'rpc'; contract: string }>
  dataModel: Array<{ entity: string; fields: string[] }>
  risks: string[]
  alternatives: string[]
} {
  const src = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const summary =
    typeof src.summary === 'string' && src.summary.length >= 20
      ? src.summary
      : 'High-level architecture for the requested change (auto-generated placeholder)'

  const archRaw = (src.architecture ?? {}) as Record<string, unknown>
  const componentsRaw = Array.isArray(archRaw.components) ? archRaw.components : []
  const components =
    componentsRaw.length > 0
      ? (componentsRaw as Array<Record<string, unknown>>).map((c) => ({
          name: typeof c.name === 'string' && c.name.length > 0 ? c.name : 'Component',
          responsibility:
            typeof c.responsibility === 'string' && c.responsibility.length > 0
              ? c.responsibility
              : 'Responsibility TBD',
        }))
      : [{ name: 'Main', responsibility: 'Implements the ticket scope' }]

  const dataFlow = Array.isArray(archRaw.dataFlow)
    ? (archRaw.dataFlow as unknown[]).map(String)
    : []

  const ifaceRaw = Array.isArray(src.interfaces) ? src.interfaces : []
  const interfaces = (ifaceRaw as Array<Record<string, unknown>>)
    .map((i) => {
      const kind = (i.kind as string) ?? 'function'
      const allowed = ['http', 'event', 'function', 'rpc'] as const
      const k = (allowed as readonly string[]).includes(kind) ? kind : 'function'
      return {
        name: typeof i.name === 'string' && i.name.length > 0 ? i.name : '',
        kind: k as 'http' | 'event' | 'function' | 'rpc',
        contract: typeof i.contract === 'string' && i.contract.length > 0 ? i.contract : '',
      }
    })
    .filter((i) => i.name.length > 0 && i.contract.length > 0)

  const dataModelRaw = Array.isArray(src.dataModel) ? src.dataModel : []
  const dataModel = (dataModelRaw as Array<Record<string, unknown>>)
    .map((d) => ({
      entity: typeof d.entity === 'string' ? d.entity : '',
      fields: Array.isArray(d.fields) ? (d.fields as unknown[]).map(String) : [],
    }))
    .filter((d) => d.entity.length > 0 && d.fields.length > 0)

  return {
    summary,
    architecture: { components, dataFlow },
    interfaces,
    dataModel,
    risks: Array.isArray(src.risks) ? (src.risks as unknown[]).map(String) : [],
    alternatives: Array.isArray(src.alternatives) ? (src.alternatives as unknown[]).map(String) : [],
  }
}
