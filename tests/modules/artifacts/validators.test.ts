// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  PrdSchema,
  DesignDocSchema,
  TaskListSchema,
  CodeDiffSchema,
  TestPlanSchema,
  DeployManifestSchema,
  VALIDATORS,
  isKnownKind,
  validatePayload,
} from '../../../src/modules/artifacts/validators'
import { ARTIFACT_KINDS } from '../../../src/modules/artifacts/types'

// ─── Valid fixtures ───

const validPrd = {
  problem: 'Users need a faster way to onboard after the UI refresh',
  personas: [{ name: 'Admin', goals: ['Invite team'] }],
  successMetrics: ['Onboarding TTV < 5 minutes'],
  requirements: {
    functional: ['Magic-link email invite'],
    nonFunctional: ['P95 < 250ms on invite endpoint'],
  },
  outOfScope: [],
  openQuestions: [],
}

const validDesignDoc = {
  summary: 'Adopt MetaGPT-style typed artifacts for team handoffs',
  architecture: {
    components: [
      { name: 'ArtifactService', responsibility: 'CRUD + versioning' },
    ],
    dataFlow: ['PM -> Architect -> Dev'],
  },
  interfaces: [
    { name: 'POST /artifacts', kind: 'http' as const, contract: 'Create artifact' },
  ],
  dataModel: [{ entity: 'Artifact', fields: ['id', 'kind', 'title'] }],
  risks: [],
  alternatives: [],
}

const validTaskList = {
  description: 'Implement artifacts module',
  tasks: [
    {
      id: 'T1',
      title: 'Create schema',
      dependsOn: [],
      status: 'todo' as const,
    },
  ],
  milestones: ['M1'],
}

const validCodeDiff = {
  summary: 'Add artifacts module',
  files: [
    { path: 'src/modules/artifacts/index.ts', action: 'add' as const, newContent: '// new' },
  ],
}

const validTestPlan = {
  scope: 'Artifacts module end-to-end',
  environments: ['ci'],
  cases: [
    {
      id: 'TC1',
      title: 'Create PRD and read it back',
      steps: ['POST PRD', 'GET by id'],
      expected: 'Payload round-trips',
    },
  ],
}

const validDeployManifest = {
  service: 'eyas-artifacts',
  version: '0.1.0',
  environment: 'staging' as const,
  image: { registry: 'ghcr.io', repository: 'acme/app', tag: 'v0.1.0' },
  replicas: 2,
  envVars: { LOG_LEVEL: 'info' },
  secrets: [],
}

describe('Artifact validators', () => {
  it('registers all declared kinds', () => {
    for (const kind of ARTIFACT_KINDS) {
      expect(VALIDATORS[kind]).toBeDefined()
    }
    expect(isKnownKind('prd')).toBe(true)
    expect(isKnownKind('bogus-kind')).toBe(false)
  })

  describe('PRD', () => {
    it('accepts a valid PRD', () => {
      const r = PrdSchema.safeParse(validPrd)
      expect(r.success).toBe(true)
    })
    it('rejects short problem statements', () => {
      const r = PrdSchema.safeParse({ ...validPrd, problem: 'too short' })
      expect(r.success).toBe(false)
    })
    it('requires at least one functional requirement', () => {
      const r = PrdSchema.safeParse({
        ...validPrd,
        requirements: { functional: [] },
      })
      expect(r.success).toBe(false)
    })
    it('defaults outOfScope / openQuestions to empty arrays', () => {
      const r = PrdSchema.parse({
        problem: 'Long enough problem statement for the validator to accept',
        personas: [{ name: 'X', goals: ['g'] }],
        successMetrics: ['m'],
        requirements: { functional: ['f'] },
      })
      expect(r.outOfScope).toEqual([])
      expect(r.openQuestions).toEqual([])
    })
  })

  describe('DesignDoc', () => {
    it('accepts valid input', () => {
      expect(DesignDocSchema.safeParse(validDesignDoc).success).toBe(true)
    })
    it('rejects empty components', () => {
      const r = DesignDocSchema.safeParse({
        ...validDesignDoc,
        architecture: { components: [], dataFlow: [] },
      })
      expect(r.success).toBe(false)
    })
    it('rejects unknown interface kind', () => {
      const r = DesignDocSchema.safeParse({
        ...validDesignDoc,
        interfaces: [{ name: 'x', kind: 'laser', contract: 'y' }],
      })
      expect(r.success).toBe(false)
    })
  })

  describe('TaskList', () => {
    it('accepts valid input', () => {
      expect(TaskListSchema.safeParse(validTaskList).success).toBe(true)
    })
    it('rejects when tasks is empty', () => {
      const r = TaskListSchema.safeParse({ ...validTaskList, tasks: [] })
      expect(r.success).toBe(false)
    })
    it('defaults task status to todo', () => {
      const parsed = TaskListSchema.parse({
        description: 'x x x',
        tasks: [{ id: 'T', title: 'X' }],
      })
      expect(parsed.tasks[0]!.status).toBe('todo')
    })
  })

  describe('CodeDiff', () => {
    it('accepts valid add with newContent', () => {
      expect(CodeDiffSchema.safeParse(validCodeDiff).success).toBe(true)
    })
    it('accepts delete without patch or newContent', () => {
      const r = CodeDiffSchema.safeParse({
        summary: 'Remove dead code',
        files: [{ path: 'old.ts', action: 'delete' }],
      })
      expect(r.success).toBe(true)
    })
    it('rejects modify missing both patch and newContent', () => {
      const r = CodeDiffSchema.safeParse({
        summary: 'Broken modify',
        files: [{ path: 'a.ts', action: 'modify' }],
      })
      expect(r.success).toBe(false)
    })
    it('rejects empty files array', () => {
      const r = CodeDiffSchema.safeParse({ summary: 'nope', files: [] })
      expect(r.success).toBe(false)
    })
  })

  describe('TestPlan', () => {
    it('accepts valid plan', () => {
      expect(TestPlanSchema.safeParse(validTestPlan).success).toBe(true)
    })
    it('rejects when cases is empty', () => {
      const r = TestPlanSchema.safeParse({ ...validTestPlan, cases: [] })
      expect(r.success).toBe(false)
    })
    it('rejects when steps is empty', () => {
      const r = TestPlanSchema.safeParse({
        ...validTestPlan,
        cases: [
          { ...validTestPlan.cases[0]!, steps: [], expected: 'x' },
        ],
      })
      expect(r.success).toBe(false)
    })
  })

  describe('DeployManifest', () => {
    it('accepts valid manifest', () => {
      expect(DeployManifestSchema.safeParse(validDeployManifest).success).toBe(true)
    })
    it('rejects unknown environment', () => {
      const r = DeployManifestSchema.safeParse({
        ...validDeployManifest,
        environment: 'qa-lab',
      })
      expect(r.success).toBe(false)
    })
    it('rejects replicas=0', () => {
      const r = DeployManifestSchema.safeParse({
        ...validDeployManifest,
        replicas: 0,
      })
      expect(r.success).toBe(false)
    })
  })

  describe('validatePayload()', () => {
    it('dispatches on kind and returns success', () => {
      const r = validatePayload('prd', validPrd)
      expect(r.success).toBe(true)
    })
    it('returns failure with issues for bad payload', () => {
      const r = validatePayload('test-plan', { scope: 'x', environments: [], cases: [] })
      expect(r.success).toBe(false)
    })
  })
})
