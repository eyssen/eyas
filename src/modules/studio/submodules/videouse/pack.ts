// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface TranscriptWord {
  text?: string
  start?: number
  end?: number
  type?: string
  speaker_id?: string
}

export interface TranscriptFile {
  text?: string
  words?: TranscriptWord[]
}

function clock(seconds: number): string {
  return seconds.toFixed(2).padStart(6, '0')
}

function speakerLabel(id: string | undefined): string {
  if (!id) return 'S0'
  const m = id.match(/(\d+)/)
  return m ? `S${m[1]}` : 'S0'
}

export function packTranscripts(
  files: Array<{ name: string; duration?: number; transcript: TranscriptFile }>,
  silenceGap = 0.5,
): string {
  const blocks: string[] = []
  for (const file of files) {
    const words = (file.transcript.words ?? []).filter((w) => w.type !== 'spacing')
    const phrases: Array<{ start: number; end: number; speaker: string; text: string }> = []
    let current: { start: number; end: number; speaker: string; words: string[] } | null = null

    const flush = () => {
      if (!current) return
      phrases.push({
        start: current.start,
        end: current.end,
        speaker: current.speaker,
        text: current.words.join(' ').replace(/\s+/g, ' ').trim(),
      })
      current = null
    }

    for (const w of words) {
      const start = typeof w.start === 'number' ? w.start : 0
      const end = typeof w.end === 'number' ? w.end : start
      const speaker = speakerLabel(w.speaker_id)
      const text = (w.text || '').trim()
      if (!text && w.type !== 'audio_event') continue
      const display = w.type === 'audio_event' ? `(${text.replace(/[()]/g, '')})` : text
      if (current && (speaker !== current.speaker || start - current.end >= silenceGap)) {
        flush()
      }
      if (!current) {
        current = { start, end, speaker, words: [display] }
      } else {
        current.end = end
        current.words.push(display)
      }
    }
    flush()

    const duration = file.duration ?? (phrases.length > 0 ? phrases[phrases.length - 1].end : 0)
    const lines = [`## ${file.name}  (duration: ${duration.toFixed(1)}s, ${phrases.length} phrases)`]
    for (const p of phrases) {
      lines.push(`  [${clock(p.start)}-${clock(p.end)}] ${p.speaker} ${p.text}`)
    }
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n\n') + (blocks.length ? '\n' : '')
}
