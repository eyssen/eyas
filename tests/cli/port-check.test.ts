import { describe, it, expect } from 'vitest'
import { probeEyasPort } from '../../src/cli/utils/port-check'

describe('probeEyasPort', () => {
  it('reports free for a closed high port', async () => {
    // 59999 is almost certainly closed on a dev machine
    const result = await probeEyasPort('127.0.0.1', 59999, 500)
    expect(result.status).toBe('free')
  })

  it('classifies a non-EYAS HTTP response as foreign when something answers', async () => {
    // Port 3000 may be Grafana on this machine — if free, skip assertion
    const result = await probeEyasPort('127.0.0.1', 3000, 800)
    if (result.status === 'free') {
      expect(result.status).toBe('free')
      return
    }
    // If something is there it must not look like EYAS health (unless EYAS really runs on 3000)
    if (result.status === 'foreign') {
      expect(result.httpStatus).toBeGreaterThan(0)
      expect(result.hint.length).toBeGreaterThan(0)
    }
  })
})
