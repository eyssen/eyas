// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ArtifactService } from '../../../artifacts/artifact-service.js'
import type { ArtifactServicePort } from '../port-types.js'

/**
 * Adapts the real (generic, kind-typed) ArtifactService — attached to
 * `ctx.artifacts` by the artifacts module (src/modules/artifacts/index.ts)
 * — onto the pipeline's narrow ArtifactServicePort.
 *
 * This is a real mapping, not a pass-through: `ArtifactService.create` is
 * generic over `ArtifactKind` and its `payload`/`link` types are stricter
 * (`ArtifactPayloadMap[K]`, `ArtifactRefType`) than the port's intentionally
 * loose `unknown`/string-literal-union shape, so a bare `(svc) => svc`
 * does not typecheck. The bridging casts below mirror the identical
 * pattern already used in tests/modules/pipelines/ticket-to-code/_helpers.ts.
 */
export function createArtifactPort(svc: ArtifactService): ArtifactServicePort {
  return {
    create: (input) => svc.create(input as any) as any,
    getWithPayload: (id) => svc.getWithPayload(id) as any,
    link: (fromId, toId, type) => svc.link(fromId, toId, type),
  }
}
