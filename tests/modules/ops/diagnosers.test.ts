// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  matchRunbook,
  renderDiagnosis,
  buildRunbookDiagnosis,
  globMatch,
  createLlmDiagnoser,
  buildDiagnosisPrompt,
} from '@modules/ops/diagnosers'
import type { Incident, Runbook } from '@modules/ops/types'

function makeIncident(p: Partial<Incident> = {}): Incident {
  return {
    id: p.id ?? 'inc-1',
    source: p.source ?? 'k8s-event',
    severity: p.severity ?? 'warning',
    kind: p.kind ?? 'pod-crashloop',
    namespace: p.namespace ?? 'prod',
    resource: p.resource ?? 'Pod/foo',
    summary: p.summary ?? 'Back-off restarting failed container',
    details: p.details ?? { reason: 'BackOff', pod: 'foo', message: 'crash' },
    signedRecord: p.signedRecord,
    verified: p.verified ?? null,
    status: p.status ?? 'open',
    createdAt: 0,
    updatedAt: 0,
  }
}

function crashloopRunbook(): Runbook {
  return {
    id: 'pod-crashloop',
    kind: 'pod-crashloop',
    matcher: {
      type: 'k8s-event',
      fields: { reason: 'BackOff' },
      regex: '*Back-off*restarting*',
    },
    diagnosisTemplate:
      'Pod {{namespace}}/{{pod}} is in CrashLoopBackOff. Reason: {{reason}}',
    suggestedAction: {
      actionType: 'kubectl',
      command: 'logs',
      args: ['-n', '{{namespace}}', '{{pod}}'],
    },
    severity: 'warning',
    requiresApproval: true,
    lastUpdated: 0,
  }
}

describe('globMatch', () => {
  it('handles star wildcard', () => {
    expect(globMatch('*foo*', 'xxfooxx')).toBe(true)
    expect(globMatch('*foo*', 'nope')).toBe(false)
  })

  it('handles question-mark wildcard', () => {
    expect(globMatch('f?o', 'foo')).toBe(true)
    expect(globMatch('f?o', 'foo-bar')).toBe(false)
  })

  it('is anchored on both ends', () => {
    expect(globMatch('foo', 'foo')).toBe(true)
    expect(globMatch('foo', 'afoo')).toBe(false)
    expect(globMatch('foo', 'fooa')).toBe(false)
  })

  it('consumes trailing stars', () => {
    expect(globMatch('foo*', 'foo')).toBe(true)
    expect(globMatch('*', '')).toBe(true)
  })
})

describe('matchRunbook', () => {
  it('matches on type + fields + regex', () => {
    const rb = crashloopRunbook()
    const i = makeIncident()
    const m = matchRunbook(i, [rb])
    expect(m?.id).toBe('pod-crashloop')
  })

  it('rejects when type differs', () => {
    const rb = crashloopRunbook()
    const i = makeIncident({ source: 'prometheus' })
    expect(matchRunbook(i, [rb])).toBeNull()
  })

  it('rejects when a matcher field mismatches', () => {
    const rb = crashloopRunbook()
    const i = makeIncident({ details: { reason: 'OOMKilled' } })
    expect(matchRunbook(i, [rb])).toBeNull()
  })

  it('rejects when regex does not match the summary', () => {
    const rb = crashloopRunbook()
    const i = makeIncident({ summary: 'something else entirely' })
    expect(matchRunbook(i, [rb])).toBeNull()
  })

  it('returns null when no runbooks provided', () => {
    expect(matchRunbook(makeIncident(), [])).toBeNull()
  })

  it('rejects overly long regex patterns', () => {
    const rb: Runbook = {
      ...crashloopRunbook(),
      matcher: { type: 'k8s-event', regex: 'a'.repeat(1000) },
    }
    expect(matchRunbook(makeIncident({ summary: 'a'.repeat(5000) }), [rb])).toBeNull()
  })
})

describe('renderDiagnosis', () => {
  it('substitutes {{namespace}}, {{pod}} and detail fields', () => {
    const out = renderDiagnosis(crashloopRunbook(), makeIncident())
    expect(out).toContain('prod/foo')
    expect(out).toContain('Reason: BackOff')
  })

  it('leaves unknown placeholders intact', () => {
    const rb: Runbook = {
      ...crashloopRunbook(),
      diagnosisTemplate: 'hi {{missing}}',
    }
    expect(renderDiagnosis(rb, makeIncident())).toBe('hi {{missing}}')
  })
})

describe('buildRunbookDiagnosis', () => {
  it('produces a diagnosis with runbook source and confidence 0.9', () => {
    const d = buildRunbookDiagnosis(crashloopRunbook(), makeIncident())
    expect(d.source).toBe('runbook')
    expect(d.runbookId).toBe('pod-crashloop')
    expect(d.confidence).toBe(0.9)
  })
})

describe('llm-diagnoser', () => {
  it('uses the llm client on fallback', async () => {
    let seen = ''
    const diag = createLlmDiagnoser({
      async complete(prompt) {
        seen = prompt
        return 'probably a network partition\nextra context'
      },
    })
    const d = await diag(makeIncident())
    expect(d.source).toBe('llm')
    expect(d.confidence).toBe(0.5)
    expect(d.explanation).toContain('probably a network partition')
    expect(d.rootCause).toBe('probably a network partition')
    expect(seen).toContain('SRE')
  })

  it('handles llm errors gracefully', async () => {
    const diag = createLlmDiagnoser({
      async complete() {
        throw new Error('model down')
      },
    })
    const d = await diag(makeIncident())
    expect(d.source).toBe('none')
    expect(d.confidence).toBe(0)
    expect(d.explanation).toContain('model down')
  })

  it('buildDiagnosisPrompt includes incident fields', () => {
    const p = buildDiagnosisPrompt(makeIncident({ namespace: 'ns-x' }))
    expect(p).toContain('ns-x')
    expect(p).toContain('pod-crashloop')
  })
})
