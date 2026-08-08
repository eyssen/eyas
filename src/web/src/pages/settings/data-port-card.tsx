import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import {
  Download,
  Upload,
  FolderOpen,
  FileArchive,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { t } from './i18n'
import { t as tc, tOr } from '@/i18n'

/** Display order for grouped review sections. */
const KIND_ORDER = [
  'memory',
  'skill',
  'rule',
  'identity',
  'knowledge',
  'unknown',
  'noise',
] as const

type SourceProfile =
  | 'auto'
  | 'claude-code'
  | 'cursor'
  | 'obsidian'
  | 'generic-md'
  | 'chat-export'
  | 'eyas-export'

type CandidateTarget =
  | 'episodic'
  | 'vault.semantic'
  | 'vault.procedural'
  | 'skill'
  | 'workspace.agents'
  | 'workspace.soul'
  | 'workspace.identity'
  | 'workspace.tools'
  | 'workspace.memory'
  | 'none'

interface ScanCandidate {
  id: string
  relativePath: string
  kind: string
  target: CandidateTarget
  title: string
  preview: string
  bytes: number
  confidence: number
  reason: string
  selectedByDefault: boolean
}

interface ScanResult {
  scanId: string
  sourceProfile: SourceProfile
  detectedProfile: SourceProfile
  rootPath: string
  instructions?: string | null
  candidates: ScanCandidate[]
  stats: { filesScanned: number; filesSkipped: number; totalBytes: number }
  warnings: string[]
}

interface ImportJob {
  id: string
  status: string
  phase: string
  progress: number
  stats: {
    processed: number
    applied: number
    skipped: number
    proposals: number
    errors: number
  }
  error: string | null
}

interface WorkspaceProposal {
  id: string
  jobId: string
  agentId: string
  workspaceFile: string
  title: string
  proposedBody: string
  existingBody: string | null
  status: string
}

type WizardStep = 'source' | 'review' | 'running' | 'done'
type KindFilter = 'all' | (typeof KIND_ORDER)[number]

const PROFILES: SourceProfile[] = [
  'auto',
  'claude-code',
  'cursor',
  'obsidian',
  'generic-md',
  'chat-export',
  'eyas-export',
]

function groupCandidates(candidates: ScanCandidate[]): Map<string, ScanCandidate[]> {
  const map = new Map<string, ScanCandidate[]>()
  for (const c of candidates) {
    const k = c.kind || 'unknown'
    const list = map.get(k) ?? []
    list.push(c)
    map.set(k, list)
  }
  return map
}

export default function DataPortCard() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<WizardStep>('source')
  const [profile, setProfile] = useState<SourceProfile>('auto')
  const [path, setPath] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [instructions, setInstructions] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<ImportJob | null>(null)
  const [proposals, setProposals] = useState<WorkspaceProposal[]>([])
  const [exportBusy, setExportBusy] = useState(false)
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  /** Collapsed kind sections — noise/unknown start collapsed. */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    noise: true,
    unknown: true,
  })
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const resetWizard = useCallback(() => {
    setStep('source')
    setProfile('auto')
    setPath('')
    setFile(null)
    setInstructions('')
    setScan(null)
    setSelected({})
    setError(null)
    setJob(null)
    setProposals([])
    setKindFilter('all')
    setCollapsed({ noise: true, unknown: true })
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const handleOpen = () => {
    resetWizard()
    setOpen(true)
  }

  const handleExport = async () => {
    setExportBusy(true)
    try {
      await api.post('/data-port/export')
    } catch (err) {
      // Expected: coming soon (503)
      if (err instanceof ApiError && err.status === 503) {
        // no-op — button already shows coming soon
      }
    } finally {
      setExportBusy(false)
    }
  }

  const runScan = async () => {
    setScanning(true)
    setError(null)
    try {
      let result: ScanResult
      const instr = instructions.trim() || undefined
      if (file) {
        const form = new FormData()
        form.append('file', file)
        form.append('sourceProfile', profile)
        if (instr) form.append('instructions', instr)
        const res = await fetch('/api/v1/data-port/import/scan-upload', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Eyas-Request': '1' },
          body: form,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || res.statusText)
        result = data as ScanResult
      } else if (path.trim()) {
        result = await api.post<ScanResult>('/data-port/import/scan', {
          path: path.trim(),
          sourceProfile: profile,
          instructions: instr,
        })
      } else {
        setError(t('settings.dataPort.wizard.needInput'))
        setScanning(false)
        return
      }

      setScan(result)
      const sel: Record<string, boolean> = {}
      for (const c of result.candidates) {
        sel[c.id] = c.selectedByDefault && c.kind !== 'noise'
      }
      setSelected(sel)
      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }

  const startImport = async () => {
    if (!scan) return
    const selection = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([candidateId]) => {
        const c = scan.candidates.find((x) => x.id === candidateId)
        return { candidateId, target: c?.target }
      })
      .filter((s) => s.target && s.target !== 'none')

    if (selection.length === 0) {
      setError(t('settings.dataPort.wizard.needSelection'))
      return
    }

    setError(null)
    setStep('running')
    try {
      const res = await api.post<{ job: ImportJob }>('/data-port/import/jobs', {
        scanId: scan.scanId,
        sourceProfile: scan.detectedProfile || profile,
        selection,
        instructions: instructions.trim() || scan.instructions || undefined,
      })
      setJob(res.job)
      pollRef.current = setInterval(async () => {
        try {
          const status = await api.get<{ job: ImportJob; proposals: WorkspaceProposal[] }>(
            `/data-port/import/jobs/${res.job.id}`,
          )
          setJob(status.job)
          setProposals(status.proposals ?? [])
          if (
            status.job.status === 'completed' ||
            status.job.status === 'failed' ||
            status.job.status === 'cancelled'
          ) {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            setStep('done')
          }
        } catch {
          /* keep polling */
        }
      }, 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('review')
    }
  }

  const approveProposal = async (id: string) => {
    try {
      await api.post(`/data-port/proposals/${id}/approve`)
      setProposals((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: 'approved' } : p)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const rejectProposal = async (id: string) => {
    try {
      await api.post(`/data-port/proposals/${id}/reject`)
      setProposals((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: 'rejected' } : p)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const selectedCount = Object.values(selected).filter(Boolean).length

  const grouped = useMemo(
    () => (scan ? groupCandidates(scan.candidates) : new Map<string, ScanCandidate[]>()),
    [scan],
  )

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const [k, list] of grouped) counts[k] = list.length
    return counts
  }, [grouped])

  const orderedKinds = useMemo(() => {
    const keys = new Set(grouped.keys())
    const ordered: string[] = []
    for (const k of KIND_ORDER) {
      if (keys.has(k)) {
        ordered.push(k)
        keys.delete(k)
      }
    }
    for (const k of [...keys].sort()) ordered.push(k)
    return ordered
  }, [grouped])

  const toggleKind = (kind: string, value: boolean) => {
    const list = grouped.get(kind) ?? []
    setSelected((prev) => {
      const next = { ...prev }
      for (const c of list) {
        if (c.kind === 'noise' || c.target === 'none') continue
        next[c.id] = value
      }
      return next
    })
  }

  const renderCandidate = (c: ScanCandidate) => (
    <label
      key={c.id}
      className={`flex gap-3 p-2.5 rounded-lg border border-border/50 cursor-pointer hover:bg-accent/30 ${
        c.kind === 'noise' || c.target === 'none' ? 'opacity-50' : ''
      }`}
    >
      <input
        type="checkbox"
        className="mt-1"
        checked={!!selected[c.id]}
        disabled={c.kind === 'noise' || c.target === 'none'}
        onChange={(e) =>
          setSelected((prev) => ({ ...prev, [c.id]: e.target.checked }))
        }
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{c.title}</span>
          <Badge variant="secondary" className="text-[10px]">
            {c.target}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {Math.round(c.confidence * 100)}%
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground truncate font-mono">
          {c.relativePath}
        </p>
        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
          {c.preview || c.reason}
        </p>
      </div>
    </label>
  )

  return (
    <>
      <div className="glass-card p-4">
        <h3 className="text-sm font-semibold mb-1">{t('settings.dataPort.heading')}</h3>
        <p className="text-xs text-muted-foreground mb-3">{t('settings.dataPort.subtitle')}</p>
        <div className="flex flex-col gap-2">
          <Button size="sm" className="justify-start" onClick={handleOpen}>
            <Upload className="h-3.5 w-3.5 mr-2" />
            {t('settings.dataPort.import')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="justify-start"
            disabled
            title={t('settings.dataPort.exportSoon')}
            onClick={handleExport}
          >
            <Download className="h-3.5 w-3.5 mr-2" />
            {t('settings.dataPort.export')}
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {t('settings.dataPort.comingSoon')}
            </Badge>
          </Button>
        </div>
        {exportBusy ? null : null}
      </div>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) resetWizard()
        }}
      >
        <DialogContent
          className={[
            // Override default sm:max-w-lg — large, resizable panel
            '!max-w-[min(96vw,72rem)] w-[min(96vw,72rem)]',
            'h-[min(90vh,52rem)] max-h-[92vh] min-w-[min(100%,36rem)] min-h-[28rem]',
            'flex flex-col gap-3 overflow-hidden p-5',
            'resize both',
          ].join(' ')}
        >
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>{t('settings.dataPort.wizard.title')}</DialogTitle>
            <p className="text-[11px] text-muted-foreground font-normal">
              {t('settings.dataPort.wizard.resizeHint')}
            </p>
          </DialogHeader>

          {error && (
            <div className="shrink-0 text-sm text-destructive flex items-start gap-2 bg-destructive/10 rounded-md p-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
            {step === 'source' && (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-sm font-medium mb-2">{t('settings.dataPort.wizard.sourceProfile')}</p>
                  <div className="flex flex-wrap gap-1">
                    {PROFILES.map((p) => (
                      <Button
                        key={p}
                        size="sm"
                        variant={profile === p ? 'secondary' : 'ghost'}
                        onClick={() => setProfile(p)}
                      >
                        {t(`settings.dataPort.profile.${p}`)}
                      </Button>
                    ))}
                  </div>
                </div>

                <Separator />

                <div>
                  <p className="text-sm font-medium mb-1 flex items-center gap-1.5">
                    <FolderOpen className="h-3.5 w-3.5" />
                    {t('settings.dataPort.wizard.pathLabel')}
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t('settings.dataPort.wizard.pathHint')}
                  </p>
                  <input
                    className="w-full bg-transparent border border-border-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="/path/to/previous/assistant"
                    value={path}
                    onChange={(e) => {
                      setPath(e.target.value)
                      if (e.target.value) setFile(null)
                    }}
                    disabled={!!file}
                  />
                </div>

                <div className="text-xs text-muted-foreground text-center">
                  {t('settings.dataPort.wizard.or')}
                </div>

                <div>
                  <p className="text-sm font-medium mb-1 flex items-center gap-1.5">
                    <FileArchive className="h-3.5 w-3.5" />
                    {t('settings.dataPort.wizard.uploadLabel')}
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t('settings.dataPort.wizard.uploadHint')}
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".zip,.md,.txt,.markdown,.json,.jsonl"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null
                      setFile(f)
                      if (f) setPath('')
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => fileRef.current?.click()}
                    disabled={!!path.trim()}
                  >
                    {file ? file.name : t('settings.dataPort.wizard.chooseFile')}
                  </Button>
                  {file && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-2"
                      onClick={() => setFile(null)}
                    >
                      {tc('common.cancel')}
                    </Button>
                  )}
                </div>

                <Separator />

                <div>
                  <p className="text-sm font-medium mb-1">
                    {t('settings.dataPort.wizard.instructionsLabel')}
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                      {t('settings.dataPort.wizard.instructionsOptional')}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t('settings.dataPort.wizard.instructionsHint')}
                  </p>
                  <textarea
                    className="w-full min-h-[96px] resize-y bg-transparent border border-border-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/70"
                    placeholder={t('settings.dataPort.wizard.instructionsPlaceholder')}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    maxLength={4000}
                  />
                  {instructions.trim() && (
                    <p className="text-[10px] text-muted-foreground mt-1 text-right">
                      {instructions.trim().length}/4000
                    </p>
                  )}
                </div>
              </div>
            )}

            {step === 'review' && scan && (
              <div className="flex flex-col gap-3 min-h-0">
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                  <span>
                    {t('settings.dataPort.wizard.detected')}:{' '}
                    <strong className="text-foreground">
                      {t(`settings.dataPort.profile.${scan.detectedProfile}`)}
                    </strong>
                  </span>
                  <span>
                    {t('settings.dataPort.wizard.filesScanned', {
                      count: scan.stats.filesScanned,
                    })}
                  </span>
                  <span>
                    {t('settings.dataPort.wizard.selectedCount', { count: selectedCount })}
                  </span>
                </div>
                {(instructions.trim() || scan.instructions) && (
                  <div className="rounded-md border border-border/50 bg-accent/20 px-3 py-2 text-xs">
                    <span className="font-medium text-foreground">
                      {t('settings.dataPort.wizard.instructionsApplied')}:{' '}
                    </span>
                    <span className="text-muted-foreground">
                      {(instructions.trim() || scan.instructions || '').slice(0, 280)}
                      {(instructions.trim() || scan.instructions || '').length > 280 ? '…' : ''}
                    </span>
                  </div>
                )}
                {scan.warnings.length > 0 && (
                  <ul className="text-xs text-amber-600 dark:text-amber-400 list-disc pl-4">
                    {scan.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}

                {/* Kind filter chips */}
                <div className="flex flex-wrap gap-1 items-center">
                  <Button
                    size="sm"
                    variant={kindFilter === 'all' ? 'secondary' : 'ghost'}
                    onClick={() => setKindFilter('all')}
                  >
                    {t('settings.dataPort.wizard.kind.all')}
                    <span className="ml-1.5 text-[10px] text-muted-foreground">
                      {scan.candidates.length}
                    </span>
                  </Button>
                  {orderedKinds.map((kind) => (
                    <Button
                      key={kind}
                      size="sm"
                      variant={kindFilter === kind ? 'secondary' : 'ghost'}
                      onClick={() => setKindFilter(kind as KindFilter)}
                    >
                      {tOr(`settings.dataPort.wizard.kind.${kind}`, kind)}
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        {kindCounts[kind] ?? 0}
                      </span>
                    </Button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const all: Record<string, boolean> = {}
                      for (const c of scan.candidates) {
                        if (c.kind !== 'noise' && c.target !== 'none') all[c.id] = true
                      }
                      setSelected(all)
                    }}
                  >
                    {t('settings.dataPort.wizard.selectAll')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected({})}>
                    {t('settings.dataPort.wizard.selectNone')}
                  </Button>
                </div>

                {/* Grouped sections */}
                <div className="flex flex-col gap-3">
                  {orderedKinds
                    .filter((kind) => kindFilter === 'all' || kindFilter === kind)
                    .map((kind) => {
                      const list = grouped.get(kind) ?? []
                      if (list.length === 0) return null
                      const isCollapsed = !!collapsed[kind] && kindFilter === 'all'
                      const selectable = list.filter(
                        (c) => c.kind !== 'noise' && c.target !== 'none',
                      )
                      const selectedInGroup = selectable.filter((c) => selected[c.id]).length

                      return (
                        <section
                          key={kind}
                          className="rounded-lg border border-border/60 overflow-hidden"
                        >
                          <div className="flex items-center gap-2 px-3 py-2 bg-accent/40">
                            <button
                              type="button"
                              className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                              onClick={() =>
                                setCollapsed((prev) => ({
                                  ...prev,
                                  [kind]: !prev[kind],
                                }))
                              }
                            >
                              {isCollapsed ? (
                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span className="text-sm font-semibold">
                                {tOr(`settings.dataPort.wizard.kind.${kind}`, kind)}
                              </span>
                              <Badge variant="outline" className="text-[10px]">
                                {list.length}
                              </Badge>
                              {selectable.length > 0 && (
                                <span className="text-[10px] text-muted-foreground">
                                  {selectedInGroup}/{selectable.length}
                                </span>
                              )}
                            </button>
                            {selectable.length > 0 && (
                              <div className="flex gap-1 shrink-0">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-[11px] px-2"
                                  onClick={() => toggleKind(kind, true)}
                                >
                                  {t('settings.dataPort.wizard.selectGroup')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-[11px] px-2"
                                  onClick={() => toggleKind(kind, false)}
                                >
                                  {t('settings.dataPort.wizard.deselectGroup')}
                                </Button>
                              </div>
                            )}
                          </div>
                          {!isCollapsed && (
                            <div className="flex flex-col gap-1.5 p-2">
                              {list.map(renderCandidate)}
                            </div>
                          )}
                        </section>
                      )
                    })}
                  {scan.candidates.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      {t('settings.dataPort.wizard.emptyScan')}
                    </p>
                  )}
                </div>
              </div>
            )}

            {step === 'running' && job && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm font-medium">{t('settings.dataPort.wizard.running')}</p>
                <p className="text-xs text-muted-foreground">
                  {job.phase} · {Math.round((job.progress || 0) * 100)}%
                </p>
                <div className="w-full h-2 rounded-full bg-accent overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${Math.round((job.progress || 0) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {step === 'done' && job && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  {job.status === 'completed' ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                  )}
                  <p className="text-sm font-medium">
                    {job.status === 'completed'
                      ? t('settings.dataPort.wizard.done')
                      : t('settings.dataPort.wizard.failed')}
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  {(
                    [
                      ['applied', job.stats.applied],
                      ['proposals', job.stats.proposals],
                      ['skipped', job.stats.skipped],
                      ['errors', job.stats.errors],
                    ] as const
                  ).map(([key, val]) => (
                    <div key={key} className="rounded-lg bg-accent/40 p-2">
                      <div className="text-lg font-semibold">{val}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {t(`settings.dataPort.wizard.stat.${key}`)}
                      </div>
                    </div>
                  ))}
                </div>
                {job.error && (
                  <p className="text-sm text-destructive">{job.error}</p>
                )}

                {proposals.filter((p) => p.status === 'pending').length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">
                      {t('settings.dataPort.wizard.proposalsHeading')}
                    </p>
                    <p className="text-xs text-muted-foreground mb-2">
                      {t('settings.dataPort.wizard.proposalsHint')}
                    </p>
                    <div className="flex flex-col gap-2">
                      {proposals
                        .filter((p) => p.status === 'pending')
                        .map((p) => (
                          <div
                            key={p.id}
                            className="border border-border/50 rounded-lg p-3 flex flex-col gap-2"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{p.title}</span>
                              <Badge variant="outline" className="text-[10px]">
                                {p.workspaceFile}
                              </Badge>
                            </div>
                            <pre className="text-[11px] text-muted-foreground bg-accent/30 rounded p-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
                              {p.proposedBody.slice(0, 2000)}
                            </pre>
                            <div className="flex gap-2 justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => rejectProposal(p.id)}
                              >
                                {t('settings.dataPort.wizard.reject')}
                              </Button>
                              <Button size="sm" onClick={() => approveProposal(p.id)}>
                                {t('settings.dataPort.wizard.approve')}
                              </Button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 gap-2 sm:gap-0 border-t border-border/40 pt-3">
            {step === 'source' && (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {tc('common.cancel')}
                </Button>
                <Button onClick={runScan} disabled={scanning || (!path.trim() && !file)}>
                  {scanning && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  {t('settings.dataPort.wizard.scan')}
                </Button>
              </>
            )}
            {step === 'review' && (
              <>
                <Button variant="ghost" onClick={() => setStep('source')}>
                  {t('settings.dataPort.wizard.back')}
                </Button>
                <Button onClick={startImport} disabled={selectedCount === 0}>
                  {t('settings.dataPort.wizard.startImport', { count: selectedCount })}
                </Button>
              </>
            )}
            {step === 'done' && (
              <Button onClick={() => setOpen(false)}>{tc('common.close')}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
