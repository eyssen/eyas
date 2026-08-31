// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'

export const GRADE_PRESETS = {
  none: '',
  warm_cinematic: 'eq=contrast=1.05:saturation=0.92:gamma=0.98,colorbalance=rs=0.04:gs=-0.01:bs=-0.03',
  neutral_punch: 'eq=contrast=1.08:saturation=1.04',
} as const

export type GradePreset = keyof typeof GRADE_PRESETS

const rangeSchema = z.object({
  source: z.string().min(1),
  start: z.number(),
  end: z.number(),
  beat: z.string().optional(),
  quote: z.string().optional(),
  reason: z.string().optional(),
})

const overlaySchema = z.object({
  file: z.string().min(1),
  start_in_output: z.number().min(0),
  duration: z.number().positive(),
})

export const edlSchema = z.object({
  version: z.literal(1).default(1),
  sources: z.record(z.string(), z.string()),
  ranges: z.array(rangeSchema),
  grade: z.string().optional(),
  overlays: z.array(overlaySchema).optional(),
  subtitles: z.string().optional(),
  total_duration_s: z.number().optional(),
})

export type VideoUseEdl = z.infer<typeof edlSchema>
export type VideoUseFinding = { level: 'error' | 'warn'; message: string }

export function parseEdl(raw: string): { edl?: VideoUseEdl; findings: VideoUseFinding[] } {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { findings: [{ level: 'error', message: 'edl.json is not valid JSON' }] }
  }
  const parsed = edlSchema.safeParse(json)
  if (!parsed.success) {
    return {
      findings: parsed.error.issues.map((i) => ({
        level: 'error' as const,
        message: `${i.path.join('.') || 'edl'}: ${i.message}`,
      })),
    }
  }
  return { edl: parsed.data, findings: lintEdl(parsed.data) }
}

export function lintEdl(edl: VideoUseEdl): VideoUseFinding[] {
  const findings: VideoUseFinding[] = []
  for (const [i, range] of edl.ranges.entries()) {
    if (!(range.source in edl.sources)) {
      findings.push({ level: 'error', message: `ranges[${i}].source '${range.source}' is not in sources` })
    }
    if (range.end <= range.start) {
      findings.push({ level: 'error', message: `ranges[${i}] end must be greater than start` })
    }
  }
  const total = edl.ranges.reduce((sum, r) => sum + Math.max(0, r.end - r.start), 0)
  if (edl.total_duration_s != null && Math.abs(edl.total_duration_s - total) > 0.5) {
    findings.push({
      level: 'warn',
      message: `total_duration_s ${edl.total_duration_s} does not match range sum ${total.toFixed(2)}`,
    })
  }
  return findings
}

export function resolveGradeFilter(grade: string | undefined): string {
  if (!grade || grade === 'none') return ''
  if (grade in GRADE_PRESETS) return GRADE_PRESETS[grade as GradePreset]
  return grade
}

export function emptyEdl(): VideoUseEdl {
  return { version: 1, sources: {}, ranges: [] as unknown as VideoUseEdl['ranges'] }
}
