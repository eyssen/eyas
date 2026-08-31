// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScheduledJob, TimelineProjection, TimelineRun } from './types'
import { t } from './i18n'

export type TimelineZoom = 'day' | 'week' | 'month'

interface Props {
  jobs: ScheduledJob[]
  runs: TimelineRun[]
  projections: TimelineProjection[]
  zoom: TimelineZoom
  offset: number
  onRangeChange?: (since: Date, until: Date) => void
  onSelectJob?: (jobId: string) => void
}

function rangeFor(zoom: TimelineZoom, offset: number): { start: Date; end: Date } {
  const now = new Date()
  let start: Date
  let end: Date
  if (zoom === 'day') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    end = new Date(start)
    end.setDate(end.getDate() + 1)
  } else if (zoom === 'week') {
    const day = now.getDay() || 7
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1 + offset * 7)
    end = new Date(start)
    end.setDate(end.getDate() + 7)
  } else {
    start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1)
  }
  return { start, end }
}

export function timelineRange(zoom: TimelineZoom, offset: number) {
  return rangeFor(zoom, offset)
}

export function TimelineCanvas({ jobs, runs, projections, zoom, offset, onSelectJob }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{
    x: number
    y: number
    job: string
    time: string
    status: string
    duration: string
  } | null>(null)
  const dotsRef = useRef<
    Array<{ x: number; y: number; radius: number; jobId: string; job: string; time: string; status: string; duration: string }>
  >([])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const jobNames = [...jobs].sort((a, b) => a.name.localeCompare(b.name))
    const rowH = Math.min(22, Math.max(14, 200 / Math.max(jobNames.length, 1)))
    const canvasH = Math.max(160, 36 + jobNames.length * rowH + 18)
    canvas.width = rect.width * dpr
    canvas.height = canvasH * dpr
    ctx.scale(dpr, dpr)
    const W = rect.width
    const H = canvasH
    ctx.clearRect(0, 0, W, H)

    const { start, end } = rangeFor(zoom, offset)
    const startMs = start.getTime()
    const endMs = end.getTime()
    const spanMs = endMs - startMs
    const nowMs = Date.now()
    const leftPad = 150
    const rightPad = 14
    const topPad = 28
    const chartW = W - leftPad - rightPad

    if (jobNames.length === 0) {
      ctx.fillStyle = 'rgba(148,163,184,0.7)'
      ctx.font = '12px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText(t('scheduler.empty'), W / 2, H / 2)
      dotsRef.current = []
      return
    }

    const jobMap = new Map(jobs.map((j) => [j.id, j]))
    const ticks: Array<{ ms: number; label: string }> = []
    if (zoom === 'day') {
      const t0 = new Date(start)
      t0.setMinutes(0, 0, 0)
      while (t0.getTime() <= endMs) {
        if (t0.getTime() >= startMs) {
          ticks.push({
            ms: t0.getTime(),
            label: t0.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
          })
        }
        t0.setTime(t0.getTime() + 3 * 3600000)
      }
    } else if (zoom === 'week') {
      const t0 = new Date(start)
      while (t0.getTime() <= endMs) {
        ticks.push({
          ms: t0.getTime(),
          label: t0.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit' }),
        })
        t0.setDate(t0.getDate() + 1)
      }
    } else {
      const t0 = new Date(start)
      while (t0.getTime() <= endMs) {
        ticks.push({
          ms: t0.getTime(),
          label: t0.toLocaleDateString(undefined, { month: 'short', day: '2-digit' }),
        })
        t0.setDate(t0.getDate() + 5)
      }
    }

    ctx.fillStyle = 'rgba(148,163,184,0.6)'
    ctx.font = '10px ui-monospace, monospace'
    ctx.textAlign = 'center'
    for (const tick of ticks) {
      const x = leftPad + ((tick.ms - startMs) / spanMs) * chartW
      if (x < leftPad - 10 || x > W - rightPad + 10) continue
      ctx.fillText(tick.label, x, topPad - 8)
      ctx.strokeStyle = 'rgba(148,163,184,0.12)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(x, topPad)
      ctx.lineTo(x, topPad + jobNames.length * rowH)
      ctx.stroke()
    }

    // now line
    const nowX = leftPad + ((nowMs - startMs) / spanMs) * chartW
    if (nowX >= leftPad && nowX <= W - rightPad) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(nowX, topPad - 2)
      ctx.lineTo(nowX, topPad + jobNames.length * rowH)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.font = '9px ui-monospace, monospace'
      ctx.fillText('now', nowX, topPad - 2)
    }

    jobNames.forEach((job, i) => {
      const y = topPad + i * rowH
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.03)'
        ctx.fillRect(leftPad, y, chartW, rowH)
      }
      ctx.fillStyle = 'rgba(148,163,184,0.85)'
      ctx.font = '11px ui-monospace, monospace'
      ctx.textAlign = 'right'
      const label = job.name.length > 22 ? job.name.slice(0, 22) + '…' : job.name
      ctx.fillText(label, leftPad - 8, y + rowH / 2 + 4)
    })

    const dots: typeof dotsRef.current = []
    const dotR = zoom === 'month' ? 2.5 : zoom === 'week' ? 3 : 4
    const idByName = new Map(jobNames.map((j, i) => [j.id, i]))

    // Duration bars for past runs (gantt polish)
    for (const run of runs) {
      const idx = idByName.get(run.jobId)
      if (idx == null) continue
      const runTime = Date.parse(run.startedAt.endsWith('Z') || run.startedAt.includes('+') ? run.startedAt : run.startedAt + 'Z')
      if (!Number.isFinite(runTime) || runTime > nowMs) continue
      const x = leftPad + ((runTime - startMs) / spanMs) * chartW
      const y = topPad + idx * rowH + rowH / 2
      if (x < leftPad - 20 || x > W - rightPad + 20) continue

      const dur = run.durationMs ?? 0
      const barW = Math.max(dotR * 2, Math.min(chartW * 0.15, (dur / spanMs) * chartW))
      if (dur > 2000 && zoom === 'day') {
        ctx.fillStyle = run.status === 'failed' ? 'rgba(248,81,73,0.25)' : 'rgba(139,148,158,0.35)'
        ctx.fillRect(x, y - 3, barW, 6)
      }

      ctx.beginPath()
      ctx.arc(x, y, dotR, 0, 2 * Math.PI)
      ctx.fillStyle = run.status === 'failed' ? 'rgba(248,81,73,0.55)' : '#8b949e'
      ctx.fill()
      if (run.status === 'failed') {
        ctx.strokeStyle = '#f85149'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      dots.push({
        x,
        y,
        radius: dotR + 5,
        jobId: run.jobId,
        job: run.jobName,
        time: new Date(runTime).toLocaleString(),
        status: run.status,
        duration: dur ? (dur < 1000 ? `${dur}ms` : `${(dur / 1000).toFixed(1)}s`) : '',
      })
    }

    // Running
    jobNames.forEach((job, idx) => {
      if (!job.isRunning) return
      const x = leftPad + ((nowMs - startMs) / spanMs) * chartW
      const y = topPad + idx * rowH + rowH / 2
      if (x < leftPad || x > W - rightPad) return
      ctx.beginPath()
      ctx.arc(x, y, dotR + 3, 0, 2 * Math.PI)
      ctx.fillStyle = 'rgba(248,81,73,0.2)'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x, y, dotR + 1, 0, 2 * Math.PI)
      ctx.fillStyle = '#f85149'
      ctx.fill()
      dots.push({
        x, y, radius: dotR + 6, jobId: job.id, job: job.name,
        time: new Date().toLocaleString(), status: 'RUNNING', duration: '',
      })
    })

    // Next + future projections
    for (const p of projections) {
      const idx = idByName.get(p.jobId)
      if (idx == null) continue
      if (p.at < startMs || p.at > endMs) continue
      const x = leftPad + ((p.at - startMs) / spanMs) * chartW
      const y = topPad + idx * rowH + rowH / 2
      if (x < leftPad || x > W - rightPad) continue
      if (p.kind === 'next') {
        const d = dotR + 1
        ctx.beginPath()
        ctx.moveTo(x, y - d)
        ctx.lineTo(x + d, y)
        ctx.lineTo(x, y + d)
        ctx.lineTo(x - d, y)
        ctx.closePath()
        ctx.fillStyle = '#3fb950'
        ctx.fill()
        dots.push({
          x, y, radius: dotR + 5, jobId: p.jobId, job: p.jobName,
          time: new Date(p.at).toLocaleString(), status: 'NEXT RUN', duration: '',
        })
      } else {
        ctx.beginPath()
        ctx.arc(x, y, Math.max(1.5, dotR - 0.5), 0, 2 * Math.PI)
        ctx.fillStyle = 'rgba(88,166,255,0.35)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(88,166,255,0.5)'
        ctx.lineWidth = 0.5
        ctx.stroke()
        dots.push({
          x, y, radius: dotR + 4, jobId: p.jobId, job: p.jobName,
          time: new Date(p.at).toLocaleString(), status: 'SCHEDULED', duration: '',
        })
      }
    }

    // Fallback nextRunAt diamonds if no projections
    if (projections.length === 0) {
      jobNames.forEach((job, idx) => {
        if (job.status !== 'active' || !job.nextRunAt) return
        const nextMs = Date.parse(job.nextRunAt)
        if (!Number.isFinite(nextMs) || nextMs < startMs || nextMs > endMs) return
        const x = leftPad + ((nextMs - startMs) / spanMs) * chartW
        const y = topPad + idx * rowH + rowH / 2
        const d = dotR + 1
        ctx.beginPath()
        ctx.moveTo(x, y - d)
        ctx.lineTo(x + d, y)
        ctx.lineTo(x, y + d)
        ctx.lineTo(x - d, y)
        ctx.closePath()
        ctx.fillStyle = '#3fb950'
        ctx.fill()
      })
    }

    // Legend
    ctx.font = '10px ui-monospace, monospace'
    ctx.textAlign = 'left'
    let lx = leftPad
    const ly = H - 6
    for (const item of [
      { color: '#8b949e', label: t('scheduler.legend.past') },
      { color: '#f85149', label: t('scheduler.legend.running') },
      { color: '#3fb950', label: t('scheduler.legend.next') },
      { color: 'rgba(88,166,255,0.5)', label: t('scheduler.legend.future') },
    ]) {
      ctx.beginPath()
      ctx.arc(lx + 4, ly - 3, 3, 0, 2 * Math.PI)
      ctx.fillStyle = item.color
      ctx.fill()
      ctx.fillStyle = 'rgba(148,163,184,0.7)'
      ctx.fillText(item.label, lx + 11, ly)
      lx += ctx.measureText(item.label).width + 22
    }
    const errCount = runs.filter((r) => r.status === 'failed').length
    ctx.textAlign = 'right'
    ctx.fillText(
      `${runs.length} ${t('scheduler.legend.runs')}${errCount ? `, ${errCount} err` : ''}`,
      W - rightPad,
      ly,
    )

    dotsRef.current = dots
    void jobMap
  }, [jobs, runs, projections, zoom, offset])

  useEffect(() => {
    draw()
    const onResize = () => draw()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [draw])

  const handleMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas || dotsRef.current.length === 0) {
      setHover(null)
      return
    }
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    let closest: (typeof dotsRef.current)[0] | null = null
    let min = Infinity
    for (const d of dotsRef.current) {
      const dist = Math.hypot(d.x - mx, d.y - my)
      if (dist < d.radius && dist < min) {
        min = dist
        closest = d
      }
    }
    if (closest) {
      setHover({
        x: Math.min(mx + 12, rect.width - 200),
        y: Math.max(my - 60, 0),
        job: closest.job,
        time: closest.time,
        status: closest.status,
        duration: closest.duration,
      })
    } else setHover(null)
  }

  const handleClick = () => {
    if (hover) {
      const hit = dotsRef.current.find((d) => d.job === hover.job)
      if (hit) onSelectJob?.(hit.jobId)
    }
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full rounded-md cursor-crosshair bg-background/40 border border-border/30"
        style={{ height: 'auto', minHeight: 160 }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onClick={handleClick}
      />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-lg"
          style={{ left: hover.x, top: hover.y }}
        >
          <div className="font-medium">{hover.job}</div>
          <div className="text-muted-foreground">{hover.time}</div>
          <div
            className={
              hover.status === 'failed' || hover.status === 'RUNNING'
                ? 'text-red-400'
                : hover.status === 'NEXT RUN'
                  ? 'text-emerald-400'
                  : hover.status === 'SCHEDULED'
                    ? 'text-sky-400'
                    : 'text-muted-foreground'
            }
          >
            {hover.status}
            {hover.duration ? ` — ${hover.duration}` : ''}
          </div>
        </div>
      )}
    </div>
  )
}
