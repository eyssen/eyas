import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ArrowLeft, Code2, Loader2, RotateCcw, Sparkles, AlertTriangle, Save, MousePointer2, Undo2, Redo2, Trash2, CheckCircle2, X } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { CanvasView } from './canvas-view'
import { PropertiesPanel } from './properties-panel'
import { TweakChips } from './tweak-chips'
import { ExportMenu } from './export-menu'
import { clockOffset, formatDuration, runElapsedMs, runNotice, serverNowAt } from './ai-run-view'
import type {
  Design, DesignVersion, ValidationIssue, DcSelection, RenderedArtboard, DesignAiRun, DesignLinkSummary,
} from './types'
import { t, tOr } from './i18n'

type Panel = 'ai' | 'source' | 'versions' | 'props' | null

/** How often a run still marked `running` on the server is re-read. */
const RUN_POLL_MS = 5_000

const STATUS_KEY: Record<'ok' | 'failed' | 'interrupted', string> = {
  ok: 'design.ai.statusOk',
  failed: 'design.ai.statusFailed',
  interrupted: 'design.ai.statusInterrupted',
}

export default function DesignDetailPage({ designId }: { designId: string }) {
  const navigate = useNavigate()
  const [design, setDesign] = useState<Design | null>(null)
  const [links, setLinks] = useState<DesignLinkSummary | null>(null)
  const [versions, setVersions] = useState<DesignVersion[]>([])
  const [renderVersion, setRenderVersion] = useState(0)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [page, setPage] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [draft, setDraft] = useState('')
  const [instruction, setInstruction] = useState('')
  /** Non-null while the title is being edited in place. */
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[]>([])

  // ── WYSIWYG ──────────────────────────────────────────────────────────────
  // The artboard lives behind a sandbox the page cannot reach into, so the
  // edited source arrives by message and is held here until an explicit save.
  // One version per save, not one per keystroke.
  const [selection, setSelection] = useState<DcSelection | null>(null)
  const [pendingBody, setPendingBody] = useState<string | null>(null)
  const [undoStack, setUndoStack] = useState<string[]>([])
  const [redoStack, setRedoStack] = useState<string[]>([])
  const [tweaks, setTweaks] = useState<Record<string, unknown>>({})
  const [propsSpec, setPropsSpec] = useState<RenderedArtboard['propsSpec']>({})
  const sendRef = useRef<((message: unknown) => void) | null>(null)
  const editing = panel === 'props'

  // ── AI runs ──────────────────────────────────────────────────────────────
  // An AI edit was measured at 8 min 43 s on a CLI provider. The request is
  // still synchronous, but every attempt is recorded server-side, so a reload
  // — or a proxy giving up on the connection — no longer loses the outcome.
  const [runs, setRuns] = useState<DesignAiRun[]>([])
  /** Server clock minus this browser's. Elapsed time is meaningless without it. */
  const [clockSkew, setClockSkew] = useState(0)
  const [nowTick, setNowTick] = useState(() => Date.now())
  /** Set while THIS tab is holding the request open; local clock, no skew. */
  const [aiStartedAt, setAiStartedAt] = useState<number | null>(null)
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null)
  const aiBusy = aiStartedAt !== null

  const load = useCallback(async () => {
    setError(null)
    try {
      const [d, v] = await Promise.all([
        api.get<{ design: Design; links?: DesignLinkSummary }>(`/designs/${designId}`),
        api.get<{ versions: DesignVersion[] }>(`/designs/${designId}/versions`),
      ])
      setDesign(d.design)
      setLinks(d.links ?? null)
      setVersions(v.versions)
      setRenderVersion((n) => n + 1)
      setSelectedFile((f) => f ?? d.design.artboards[0] ?? null)
      setPage((p) => p ?? d.design.manifest.pages?.[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }, [designId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (panel === 'source' && design && selectedFile) setDraft(design.files[selectedFile] ?? '')
  }, [panel, design, selectedFile])

  const loadRuns = useCallback(async () => {
    try {
      const res = await api.get<{ runs: DesignAiRun[]; now: number }>(`/designs/${designId}/ai/runs?limit=5`)
      setRuns(res.runs)
      setClockSkew(clockOffset(res.now, Date.now()))
    } catch {
      // Deliberately kept quiet, and deliberately NOT clearing what we have:
      // this endpoint only reports on other work. Failing to read it must not
      // replace a real last-run notice with an empty panel, and must never
      // take down a page whose canvas loaded fine.
    }
  }, [designId])

  useEffect(() => { void loadRuns() }, [loadRuns])

  const notice = useMemo(() => runNotice(runs), [runs])

  // Someone else's run — another tab, or this one before a reload — is only
  // visible by asking again.
  useEffect(() => {
    if (notice.kind !== 'running') return
    const id = setInterval(() => { void loadRuns() }, RUN_POLL_MS)
    return () => clearInterval(id)
  }, [notice.kind, loadRuns])

  const timing = aiBusy || notice.kind === 'running'
  useEffect(() => {
    if (!timing) return
    setNowTick(Date.now())
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timing])

  const elapsedMs = aiStartedAt !== null
    ? Math.max(0, nowTick - aiStartedAt)
    : notice.kind === 'running'
      ? runElapsedMs(notice.run, serverNowAt(nowTick, clockSkew))
      : 0

  // Selecting a different artboard abandons the edit state for the old one.
  useEffect(() => {
    setSelection(null)
    setPendingBody(null)
    setUndoStack([])
    setRedoStack([])
    setTweaks({})
  }, [selectedFile])

  // The declared tweaks come back with the render payload.
  useEffect(() => {
    if (!design || !selectedFile) return
    let cancelled = false
    api.get<RenderedArtboard>(`/designs/${design.id}/render/${selectedFile}`)
      .then((r) => { if (!cancelled) setPropsSpec(r.propsSpec ?? {}) })
      .catch(() => { if (!cancelled) setPropsSpec({}) })
    return () => { cancelled = true }
  }, [design, selectedFile, renderVersion])

  const onSource = useCallback((body: string) => {
    setPendingBody((previous) => {
      setUndoStack((stack) => [...stack, previous ?? ''].slice(-50))
      setRedoStack([])
      return body
    })
  }, [])

  const patchStyles = useCallback((styles: Record<string, string | null>) => {
    if (!selection || !sendRef.current) return
    sendRef.current({ type: 'dc:setStyle', index: selection.index, styles })
    setSelection((s) => (s ? { ...s, styles: { ...s.styles, ...Object.fromEntries(Object.entries(styles).filter(([, v]) => v !== null)) as Record<string, string> } } : s))
  }, [selection])

  const patchText = useCallback((text: string) => {
    if (!selection || !sendRef.current) return
    sendRef.current({ type: 'dc:setText', index: selection.index, text })
    setSelection((s) => (s ? { ...s, text } : s))
  }, [selection])

  const applyTweak = useCallback((prop: string, value: unknown) => {
    setTweaks((t) => ({ ...t, [prop]: value }))
    sendRef.current?.({ type: 'dc:setProps', props: { [prop]: value } })
  }, [])

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack
      const previous = stack[stack.length - 1]
      setRedoStack((r) => [...r, pendingBody ?? ''])
      setPendingBody(previous || null)
      if (previous && sendRef.current) sendRef.current({ type: 'dc:select', index: null })
      return stack.slice(0, -1)
    })
  }, [pendingBody])

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack
      const next = stack[stack.length - 1]
      setUndoStack((u) => [...u, pendingBody ?? ''])
      setPendingBody(next || null)
      return stack.slice(0, -1)
    })
  }, [pendingBody])

  useEffect(() => {
    if (!editing) return
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, undo, redo])

  const dirty = useMemo(
    () => panel === 'source' && !!design && !!selectedFile && draft !== (design.files[selectedFile] ?? ''),
    [panel, design, selectedFile, draft],
  )

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null); setIssues([])
    try {
      await fn()
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  /** The API returns validator issues on 422; surface them, they are actionable. */
  async function post<T>(path: string, body: unknown, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
    const res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Eyas-Request': '1' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (Array.isArray(data.issues)) setIssues(data.issues)
      throw new Error(data.message || data.error || res.statusText)
    }
    return data as T
  }

  const saveEdits = () => run(async () => {
    if (!design || !selectedFile || pendingBody === null) return
    await post(`/designs/${design.id}/body`, { file: selectedFile, template: pendingBody }, 'PUT')
    setPendingBody(null)
    setUndoStack([])
    setRedoStack([])
    await load()
  })

  const pinTweak = (prop: string, value: unknown) => run(async () => {
    if (!design || !selectedFile) return
    await post(`/designs/${design.id}/props`, { file: selectedFile, prop, value }, 'PUT')
    await load()
  })

  const commitTitle = () => {
    const next = (titleDraft ?? '').trim()
    setTitleDraft(null)
    if (!design || !next || next === design.title) return
    void run(async () => {
      await api.patch(`/designs/${design.id}`, { title: next })
      await load()
    })
  }

  const saveSource = () => run(async () => {
    if (!design || !selectedFile) return
    await api.put(`/designs/${design.id}/files/${selectedFile}`, { content: draft })
    await load()
  })

  const askAi = () => run(async () => {
    if (!design || !instruction.trim()) return
    setAiStartedAt(Date.now())
    setDismissedRunId(null)
    try {
      await post(`/designs/${design.id}/ai`, {
        instruction: instruction.trim(),
        ...(selectedFile && design.artboards.length > 3 ? { targetFile: selectedFile } : {}),
      })
      setInstruction('')
      await load()
    } finally {
      // The row is what the panel reports from, so it is read back on the way
      // out of both the success and the failure path.
      setAiStartedAt(null)
      await loadRuns()
    }
  })

  const removeDesign = () => {
    if (!design) return
    const confirmed = window.confirm(t('design.detail.deleteConfirm', {
      title: design.title,
      versions: versions.length,
      links: links?.total ?? 0,
    }))
    if (!confirmed) return
    void run(async () => {
      await api.delete(`/designs/${design.id}`)
      navigate({ to: '/design' })
    })
  }

  const restore = (version: number) => run(async () => {
    await post(`/designs/${designId}/restore/${version}`, {})
    await load()
  })

  if (!design) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {error ? <span className="text-[hsl(var(--destructive))]">{error}</span> : t('design.detail.loading')}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[hsl(var(--border))] px-4 py-2">
        <Link to="/design" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          {titleDraft === null ? (
            <button
              type="button"
              onClick={() => setTitleDraft(design.title)}
              title={t('design.detail.rename')}
              className="block max-w-full truncate text-left font-medium hover:underline decoration-dotted underline-offset-4"
            >
              {design.title}
            </button>
          ) : (
            <input
              autoFocus
              value={titleDraft}
              aria-label={t('design.detail.rename')}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle()
                // Escape must abandon the edit, not save an accidental keystroke.
                if (e.key === 'Escape') setTitleDraft(null)
              }}
              className="w-64 rounded border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-1.5 py-0.5 font-medium outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
            />
          )}
          <div className="text-xs text-muted-foreground">
            {t(`design.kind.${design.kind}`)} · v{design.currentVersion} · {design.artboards.length} {t('design.detail.artboards')}
          </div>
        </div>

        {(design.manifest.pages?.length ?? 0) > 1 && (
          <div className="ml-3 flex items-center gap-1">
            {design.manifest.pages!.map((p) => (
              <Button key={p.id} size="sm" variant={page === p.id ? 'default' : 'ghost'} onClick={() => setPage(p.id)}>
                {p.name}
              </Button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant={panel === 'props' ? 'default' : 'ghost'} onClick={() => setPanel(panel === 'props' ? null : 'props')}>
            <MousePointer2 className="h-3.5 w-3.5 mr-1" />{t('design.detail.edit')}
          </Button>
          <Button size="sm" variant={panel === 'ai' ? 'default' : 'ghost'} onClick={() => setPanel(panel === 'ai' ? null : 'ai')}>
            {timing
              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              : <Sparkles className="h-3.5 w-3.5 mr-1" />}
            {t('design.detail.ai')}
            {/* A failed edit has to be visible without opening the panel — not
                knowing whether anything happened was the original complaint. */}
            {!timing && (notice.kind === 'failed' || notice.kind === 'interrupted') && notice.run.id !== dismissedRunId && (
              <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--destructive))]" />
            )}
          </Button>
          <Button size="sm" variant={panel === 'source' ? 'default' : 'ghost'} onClick={() => setPanel(panel === 'source' ? null : 'source')}>
            <Code2 className="h-3.5 w-3.5 mr-1" />{t('design.detail.source')}
          </Button>
          <Button size="sm" variant={panel === 'versions' ? 'default' : 'ghost'} onClick={() => setPanel(panel === 'versions' ? null : 'versions')}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />{t('design.detail.history')}
          </Button>
          <ExportMenu designId={design.id} artboard={selectedFile} />
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive))]/10"
            aria-label={t('design.detail.delete')}
            title={t('design.detail.delete')}
            onClick={removeDesign}
            disabled={busy}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {(error || issues.length > 0) && (
        <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-4 py-2 text-xs">
          {error && (
            <div className="flex items-start gap-2 text-[hsl(var(--destructive))]">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {issues.map((i, n) => <li key={`${i.code}-${n}`}>{i.path ? `${i.path}: ` : ''}{i.message}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <CanvasView
            design={design}
            version={renderVersion}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            page={page}
            editing={editing}
            onSelectElement={setSelection}
            onSource={onSource}
            onFrameReady={(send) => { sendRef.current = send }}
          />
        </div>

        {panel && (
          <aside className="w-[420px] shrink-0 overflow-y-auto border-l border-[hsl(var(--border))] p-4">
            {panel === 'props' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="section-label">{t('design.props.heading')}</div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" aria-label={t('design.detail.undo')} onClick={undo} disabled={undoStack.length === 0}>
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={t('design.detail.redo')} onClick={redo} disabled={redoStack.length === 0}>
                      <Redo2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" onClick={saveEdits} disabled={busy || pendingBody === null}>
                      <Save className="h-3.5 w-3.5 mr-1" />
                      {pendingBody === null ? t('design.detail.noChanges') : t('design.detail.saveEdits')}
                    </Button>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {design.manifest.artboards?.find((a) => a.file === selectedFile)?.is_interactive
                    ? t('design.props.interactiveHint')
                    : t('design.props.clickHint')}
                </p>

                {Object.keys(propsSpec).length > 0 && (
                  <>
                    <div className="section-label">{t('design.tweaks.heading')}</div>
                    <TweakChips specs={propsSpec} values={tweaks} onChange={applyTweak} onPin={pinTweak} busy={busy} />
                    <Separator />
                  </>
                )}

                <PropertiesPanel selection={selection} onPatch={patchStyles} onText={patchText} />
              </div>
            )}

            {panel === 'ai' && (
              <div className="space-y-3">
                <div className="section-label">{t('design.ai.heading')}</div>
                <p className="text-xs text-muted-foreground">{t('design.ai.hint')}</p>
                <textarea
                  className="w-full rounded-md bg-transparent border border-[hsl(var(--border))] p-2 text-sm"
                  rows={5}
                  value={instruction}
                  placeholder={t('design.ai.placeholder')}
                  onChange={(e) => setInstruction(e.target.value)}
                />
                <Button size="sm" onClick={askAi} disabled={busy || timing || !instruction.trim()}>
                  {timing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                  {t('design.ai.apply')}
                </Button>

                {timing && (
                  <div className="space-y-1 rounded-md border border-[hsl(var(--border))] px-2.5 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      <span>{t('design.ai.running')}</span>
                      <span className="ml-auto tabular-nums text-muted-foreground">{formatDuration(elapsedMs)}</span>
                    </div>
                    <p className="text-muted-foreground">{t('design.ai.slowHint')}</p>
                  </div>
                )}

                {/* `!timing` already excludes 'running': TypeScript narrows through the
                    aliased condition, so STATUS_KEY below is exhaustive. */}
                {!timing && notice.kind !== 'none' && notice.run.id !== dismissedRunId && (
                  <div className="space-y-1 rounded-md border border-[hsl(var(--border))] px-2.5 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      {notice.kind === 'ok'
                        ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--destructive))]" />}
                      <span className="font-medium">{t('design.ai.lastRun')}</span>
                      <span className="text-muted-foreground">· {t(STATUS_KEY[notice.kind])}</span>
                      <button
                        type="button"
                        aria-label={t('design.ai.dismiss')}
                        title={t('design.ai.dismiss')}
                        className="ml-auto text-muted-foreground hover:text-foreground"
                        onClick={() => setDismissedRunId(notice.run.id)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {/* An interrupted run never finished its work, so its
                        elapsed time measures the wait for a restart, not the
                        edit — reporting it as a duration would be a lie. */}
                    {notice.kind !== 'interrupted' && (
                      <div className="text-muted-foreground">
                        {t('design.ai.runMeta', {
                          tier: notice.run.tier ? tOr(`design.ai.tier.${notice.run.tier}`, notice.run.tier) : '—',
                          elapsed: formatDuration(notice.run.durationMs ?? 0),
                          attempts: notice.run.attempts ?? 1,
                        })}
                      </div>
                    )}
                    {notice.run.message && (
                      <p className="whitespace-pre-wrap break-words text-muted-foreground">{notice.run.message}</p>
                    )}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">{t('design.ai.gateNote')}</p>
              </div>
            )}

            {panel === 'source' && (
              <div className="space-y-3">
                <div className="section-label">{t('design.source.heading')}</div>
                <div className="flex flex-wrap gap-1">
                  {Object.keys(design.files).sort().map((f) => (
                    <Button key={f} size="sm" variant={selectedFile === f ? 'default' : 'outline'} onClick={() => setSelectedFile(f)}>
                      {f}
                    </Button>
                  ))}
                </div>
                <textarea
                  className="w-full rounded-md bg-transparent border border-[hsl(var(--border))] p-2 text-xs font-mono"
                  rows={24}
                  spellCheck={false}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <Button size="sm" onClick={saveSource} disabled={busy || !dirty}>
                  <Save className="h-3.5 w-3.5 mr-1" />
                  {dirty ? t('design.source.save') : t('design.source.saved')}
                </Button>
              </div>
            )}

            {panel === 'versions' && (
              <div className="space-y-2">
                <div className="section-label">{t('design.detail.history')}</div>
                {versions.slice().reverse().map((v) => (
                  <div key={v.version} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      v{v.version} <Badge variant="secondary">{t(`design.origin.${v.origin}`)}</Badge>{' '}
                      <span className="text-muted-foreground">{v.changeNote ?? '—'}</span>
                    </span>
                    {v.version !== design.currentVersion && (
                      <Button size="sm" variant="ghost" onClick={() => restore(v.version)} disabled={busy}>
                        {t('design.detail.restore')}
                      </Button>
                    )}
                  </div>
                ))}
                <Separator />
                <p className="text-xs text-muted-foreground">{t('design.detail.restoreNote')}</p>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
