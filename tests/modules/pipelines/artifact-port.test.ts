// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createArtifactPort } from '@modules/pipelines/ticket-to-code/adapters/artifact-port'
import { createArtifactTables } from '@modules/artifacts/schema'
import { createArtifactService } from '@modules/artifacts/artifact-service'
import { createMemoryDb } from '../../helpers/test-db'

describe('createArtifactPort', () => {
  it('maps the real ArtifactService onto ArtifactServicePort (create/getWithPayload/link)', () => {
    const db = createMemoryDb()
    createArtifactTables(db)
    const svc = createArtifactService(db)
    const port = createArtifactPort(svc)

    const a = port.create({
      sessionId: null,
      kind: 'prd',
      title: 'Test PRD',
      payload: {
        problem: 'A problem statement that is definitely long enough.',
        personas: [{ name: 'Customer', goals: ['Do the thing'] }],
        successMetrics: ['Ticket closed'],
        requirements: { functional: ['Do the thing'] },
        outOfScope: [],
        openQuestions: [],
      },
      producedBy: 'stage:ingest',
    })
    expect(a.id).toBeTruthy()
    expect(a.kind).toBe('prd')

    const fetched = port.getWithPayload(a.id)
    expect(fetched?.id).toBe(a.id)
    expect(fetched?.payload).toBeTruthy()

    const b = port.create({
      sessionId: null,
      kind: 'prd',
      title: 'Second PRD',
      payload: {
        problem: 'Another problem statement that is long enough too.',
        personas: [{ name: 'Customer', goals: ['Do another thing'] }],
        successMetrics: ['Ticket closed'],
        requirements: { functional: ['Do another thing'] },
        outOfScope: [],
        openQuestions: [],
      },
      producedBy: 'stage:ingest',
    })
    expect(() => port.link(a.id, b.id, 'derives_from')).not.toThrow()

    expect(port.getWithPayload('missing')).toBeNull()
  })
})
