// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule } from '@core/types'

/**
 * Ticket-to-code pipeline module manifest (Phase 4D).
 *
 * Flow-style deterministic multi-agent pipeline. Takes a ticket (an internal
 * board conversation, or a manually-entered one) and drives it sequentially
 * through stages: ingest → pm-clarify → architect-design → dev-implement →
 * review → pr-open → deploy.
 *
 * Each stage produces a typed Artifact (see Phase 3H Artifacts module) and
 * consumes the previous one. Pattern inspired by MetaGPT's SOP.
 */
export const ticketToCodePipelineManifest: Pick<
  EyasModule,
  'id' | 'name' | 'version' | 'type' | 'required' | 'description' | 'dependencies' | 'optional' | 'capabilities'
> = {
  id: 'pipelines.ticket-to-code',
  name: 'Ticket-to-Code Pipeline',
  version: '0.1.0',
  type: 'extra',
  required: false,
  description:
    'Deterministic multi-agent pipeline: ticket → PRD → Design → Code → Tests → PR → Deploy. Built on the Artifacts module with per-stage approval gates, checkpointing, and resumable execution after failure.',
  // 'agent' (ctx.agents.executeAgent) and 'conversations' (ctx.conversations,
  // the internal board's ticket source) are hard deps so ModuleLoader starts
  // this module strictly after them — see index.ts onStart.
  dependencies: ['artifacts', 'permissions', 'agent', 'conversations'],
  optional: ['event-store', 'audit'],
  capabilities: ['pipeline', 'sop', 'ticket-to-code', 'multi-agent-flow'],
}
