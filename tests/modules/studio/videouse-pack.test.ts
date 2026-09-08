// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { packTranscripts } from '@modules/studio/submodules/videouse/pack'
import { lintEdl, parseEdl } from '@modules/studio/submodules/videouse/edl'

describe('videouse pack + edl', () => {
  it('packs word-level transcripts into phrase lines on silence', () => {
    const md = packTranscripts([
      {
        name: 'C0103',
        duration: 10,
        transcript: {
          words: [
            { type: 'word', text: 'Hello', start: 1, end: 1.4, speaker_id: 'speaker_0' },
            { type: 'word', text: 'world', start: 1.5, end: 2, speaker_id: 'speaker_0' },
            { type: 'word', text: 'Later', start: 6, end: 6.5, speaker_id: 'speaker_0' },
          ],
        },
      },
    ])
    expect(md).toContain('## C0103')
    expect(md).toContain('S0 Hello world')
    expect(md).toContain('S0 Later')
  })

  it('lints a valid EDL', () => {
    const { edl, findings } = parseEdl(JSON.stringify({
      version: 1,
      sources: { A: '/tmp/a.mp4' },
      ranges: [{ source: 'A', start: 1, end: 3 }],
    }))
    expect(edl).toBeTruthy()
    expect(findings.filter((f) => f.level === 'error')).toHaveLength(0)
  })

  it('rejects a range with unknown source', () => {
    const findings = lintEdl({
      version: 1,
      sources: {},
      ranges: [{ source: 'missing', start: 0, end: 1 }],
    })
    expect(findings.some((f) => /not in sources/.test(f.message))).toBe(true)
  })
})
