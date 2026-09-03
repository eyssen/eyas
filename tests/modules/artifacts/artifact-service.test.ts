// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createArtifactTables } from '../../../src/modules/artifacts/schema'
import {
  createArtifactService,
  ArtifactValidationError,
  UnknownArtifactKindError,
  type ArtifactService,
} from '../../../src/modules/artifacts/artifact-service'

const validPrd = {
  problem: 'Users need a faster onboarding experience for the UI refresh',
  personas: [{ name: 'Admin', goals: ['Invite teammates'] }],
  successMetrics: ['Onboarding TTV < 5 min'],
  requirements: { functional: ['Magic-link email invite'] },
  outOfScope: [],
  openQuestions: [],
}

const validDesign = {
  summary: 'Introduce artifacts module with Zod validation',
  architecture: {
    components: [{ name: 'ArtifactService', responsibility: 'CRUD' }],
    dataFlow: [],
  },
  interfaces: [],
  dataModel: [],
  risks: [],
  alternatives: [],
}

describe('ArtifactService', () => {
  let db: ReturnType<typeof createMemoryDb>
  let service: ArtifactService

  beforeEach(() => {
    db = createMemoryDb()
    createArtifactTables(db)
    service = createArtifactService(db)
  })

  describe('create', () => {
    it('creates a validated PRD artifact at version 1', () => {
      const a = service.create({
        sessionId: 'sess1',
        kind: 'prd',
        title: 'My PRD',
        payload: validPrd as any,
        producedBy: 'agent_pm',
      })
      expect(a.id).toBeTruthy()
      expect(a.currentVersion).toBe(1)
      expect(a.kind).toBe('prd')
      expect(a.sessionId).toBe('sess1')
      expect(a.consumedBy).toEqual([])
      expect(a.payload).toBeDefined()

      const versions = service.listVersions(a.id)
      expect(versions).toHaveLength(1)
      expect(versions[0]!.version).toBe(1)
    })

    it('rejects an invalid payload with ArtifactValidationError', () => {
      expect(() =>
        service.create({
          sessionId: null,
          kind: 'prd',
          title: 'Bad',
          payload: { problem: 'too short' } as any,
        }),
      ).toThrow(ArtifactValidationError)
    })

    it('rejects unknown artifact kinds', () => {
      expect(() =>
        service.create({
          sessionId: null,
          kind: 'bogus' as any,
          title: 'x',
          payload: {} as any,
        }),
      ).toThrow(UnknownArtifactKindError)
    })
  })

  describe('update / versioning', () => {
    it('bumps currentVersion and appends to history', () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      const v2 = {
        ...validPrd,
        successMetrics: ['Onboarding TTV < 3 min', 'CSAT > 4.5'],
      }
      const updated = service.update(a.id, v2 as any, 'agent_pm', 'tighten metrics')
      expect(updated.currentVersion).toBe(2)
      const versions = service.listVersions(a.id)
      expect(versions).toHaveLength(2)
      expect(versions[1]!.changeNote).toBe('tighten metrics')
    })

    it('rejects an update with an invalid payload', () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      expect(() =>
        service.update(a.id, { problem: 'too short' } as any, 'agent_pm'),
      ).toThrow(ArtifactValidationError)
      // Still v1 (no row inserted)
      expect(service.get(a.id)!.currentVersion).toBe(1)
    })

    it('getLatestVersion returns the highest version payload', () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      service.update(a.id, { ...validPrd, outOfScope: ['billing'] } as any, 'pm')
      const latest = service.getLatestVersion(a.id)
      expect(latest?.version).toBe(2)
      expect((latest?.payload as any).outOfScope).toEqual(['billing'])
    })
  })

  describe('listByKind / listBySession', () => {
    it('filters by kind and optionally by session', () => {
      service.create({ sessionId: 's1', kind: 'prd', title: 'P1', payload: validPrd as any })
      service.create({ sessionId: 's1', kind: 'design-doc', title: 'D1', payload: validDesign as any })
      service.create({ sessionId: 's2', kind: 'prd', title: 'P2', payload: validPrd as any })

      expect(service.listByKind('prd')).toHaveLength(2)
      expect(service.listByKind('prd', 's1')).toHaveLength(1)
      expect(service.listBySession('s1')).toHaveLength(2)
    })
  })

  describe('markConsumedBy', () => {
    it('records each consumer exactly once', () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      service.markConsumedBy(a.id, 'agent_architect')
      service.markConsumedBy(a.id, 'agent_architect') // idempotent
      service.markConsumedBy(a.id, 'agent_dev')

      const after = service.get(a.id)!
      expect(after.consumedBy).toEqual(['agent_architect', 'agent_dev'])
    })
  })

  describe('link / backlinks', () => {
    it('stores typed refs and reports back/forward links', () => {
      const prd = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      const design = service.create({
        sessionId: null,
        kind: 'design-doc',
        title: 'D',
        payload: validDesign as any,
      })
      service.link(design.id, prd.id, 'derives_from')

      expect(service.backlinks(prd.id).map((x) => x.id)).toEqual([design.id])
      expect(service.forwardLinks(design.id).map((x) => x.id)).toEqual([prd.id])
    })

    it('refuses to link an artifact to itself', () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      expect(() => service.link(a.id, a.id, 'implements')).toThrow()
    })

    it('dedupes repeat links of the same type', () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'A',
        payload: validPrd as any,
      })
      const b = service.create({
        sessionId: null,
        kind: 'design-doc',
        title: 'B',
        payload: validDesign as any,
      })
      service.link(b.id, a.id, 'derives_from')
      service.link(b.id, a.id, 'derives_from')
      expect(service.backlinks(a.id)).toHaveLength(1)
    })
  })

  describe('getWithPayload', () => {
    it('returns null for unknown id', () => {
      expect(service.getWithPayload('does-not-exist')).toBeNull()
    })
    it('attaches latest payload to the artifact', () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      const fetched = service.getWithPayload(a.id)
      expect(fetched?.payload).toBeDefined()
      expect((fetched?.payload as any).problem).toContain('onboarding')
    })
  })
})
