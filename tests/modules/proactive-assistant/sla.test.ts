import { describe, it, expect } from 'vitest'
import { evaluateSla, formatSlaEscalation } from '@modules/proactive-assistant/sla'

describe('SLA evaluation', () => {
  const now = new Date('2026-08-08T12:00:00Z')

  it('detects overdue cards', () => {
    const signal = evaluateSla(
      [
        {
          id: 'c1',
          title: 'Fix prod',
          due_date: '2026-08-01T00:00:00Z',
          updated_at: '2026-08-07T00:00:00Z',
          status: 'open',
        },
      ],
      undefined,
      now,
    )
    expect(signal.count).toBe(1)
    expect(signal.breaches[0].reason).toBe('overdue')
  })

  it('detects stale cards', () => {
    const signal = evaluateSla(
      [
        {
          id: 'c2',
          title: 'Old work',
          updated_at: '2026-08-01T00:00:00Z',
          status: 'open',
        },
      ],
      { staleHours: 48, overdueGraceHours: 0 },
      now,
    )
    expect(signal.count).toBe(1)
    expect(signal.breaches[0].reason).toBe('stale')
  })

  it('formats escalation text', () => {
    const signal = evaluateSla(
      [{ id: 'c1', title: 'X', due_date: '2020-01-01', status: 'open' }],
      undefined,
      now,
    )
    const text = formatSlaEscalation(signal)
    expect(text).toMatch(/SLA breaches/)
    expect(text).toMatch(/OVERDUE/)
  })
})
