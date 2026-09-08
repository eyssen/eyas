// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The data-port card and the import wizard's shell: source → scanning → review
// → running → done. The shell owns the scan header, the selection WIRE (never a
// list of ids — a whole home directory is selected in one small request, P-10),
// the job poll and the two result screens; the review step owns everything the
// owner reads and clicks, and holds none of the rows.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import {
  Download,
  Upload,
  FolderOpen,
  FileArchive,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Undo2,
} from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { t } from './i18n'
import { t as tc, tOr } from '@/i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'
import { useLanguageStore } from '@/stores/language-store'
import DataPortReview from './data-port-review'
import { formatDuration, progressSummary } from './data-port-progress'
import { kindLabel, reasonLabel, scanWarningText } from './data-port-reason-label'
import type {
  ImportJob,
  RollbackResult,
  ScanSummary,
  SelectionWire,
  SourceProfile,
  WorkspaceProposal,
} from './data-port-types'

interface ProfileInfo {
  id: SourceProfile
  rootHints: string[]
}

type WizardStep = 'source' | 'scanning' | 'review' | 'running' | 'done'

/** A job in one of these states has nothing left to poll for. */
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'rolled_back']

/** Only a finished job has anything on disk worth taking back. */
const ROLLBACKABLE_STATUSES = ['completed', 'failed']

/**
 * The poll has to be bounded. A server restart leaves a job row on `running`
 * with nobody left to advance it, so an unbounded interval would spin until the
 * tab is closed and tell the owner nothing. The server marks such rows `failed`
 * on its next start; until then the card stops, says so, and points at the
 * history list where the rollback button appears once it does.
 */
const POLL_INTERVAL_MS = 1200
/**
 * Silence, not duration, is what says a job is stuck. A whole home directory
 * can legitimately take an hour, so the poll gives up only when the job stops
 * *moving* — no change to phase, progress, any stat counter or the cursor for
 * this long.
 */
const POLL_NO_PROGRESS_MS = 10 * 60 * 1000
/** Consecutive failed status reads before giving up; one blip must not count. */
const POLL_MAX_ERRORS = 5

/** P-9 — the scan runs in the background and `GET /scans/:id` is polled every second. */
const SCAN_POLL_MS = 1000

/** The wire a fresh review starts from: the scan's own suggestion, nothing overridden. */
const emptyWire = (): SelectionWire => ({ base: 'default', groups: [], rows: [] })

/**
 * Everything the server tells us about forward motion, as one comparable
 * string. Any counter ticking — even `skipped` on a run of noise rows — proves
 * the job is alive, and so does the keyset cursor advancing through a stretch
 * of rows that all resolve to `unchanged`, which is why `cursorSeq` and
 * `updatedAt` belong here beside the counters.
 */
function progressFingerprint(job: ImportJob): string {
  const s = job.stats
  return [
    job.status,
    job.phase,
    job.progress,
    s?.processed,
    s?.applied,
    s?.skipped,
    s?.unchanged,
    s?.proposals,
    s?.errors,
    s?.total,
    s?.elapsedMs,
    job.cursorSeq,
    job.updatedAt,
  ].join('|')
}

function rollbackCount(result: RollbackResult | undefined): number {
  return Object.values(result?.removed ?? {}).reduce((a, b) => a + b, 0)
}

/**
 * Dates follow the language the owner chose in EYAS, not the browser's. `tlh`
 * is a well-formed tag with no date data behind it, so it borrows English
 * formatting rather than silently falling back to whatever the host is set to.
 */
function dateLocale(lang: string): string {
  return lang === 'tlh' ? 'en' : lang
}

function formatDateTime(value: string, lang: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(dateLocale(lang))
}

/**
 * A proposal for the project-type prompt belongs to no agent, so it is stored
 * with the sentinel id '-' and no name. Naming its destination reads better
 * than a bare dash.
 */
function proposalAgentLabel(p: WorkspaceProposal): string {
  if (p.agentName) return p.agentName
  if (p.agentId === '-') return t('settings.dataPort.wizard.target.prompt.project-type')
  return p.agentId
}

/**
 * `project-type:general` is a routing token, not a filename. Name the
 * destination instead, keeping the project-type id only when it says something
 * the label does not.
 */
function proposalFileLabel(p: WorkspaceProposal): string {
  const prefix = 'project-type:'
  if (!p.workspaceFile.startsWith(prefix)) return p.workspaceFile
  const label = tOr('settings.dataPort.wizard.target.prompt.project-type', 'prompt.project-type')
  const id = p.workspaceFile.slice(prefix.length)
  return id && id !== 'general' ? `${label} · ${id}` : label
}

export default function DataPortCard() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<WizardStep>('source')
  const [profile, setProfile] = useState<SourceProfile>('auto')
  const [path, setPath] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [instructions, setInstructions] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scan, setScan] = useState<ScanSummary | null>(null)
  const [wire, setWire] = useState<SelectionWire>(emptyWire)
  const [resolvedCount, setResolvedCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<ImportJob | null>(null)
  const [proposals, setProposals] = useState<WorkspaceProposal[]>([])
  const [exportBusy, setExportBusy] = useState(false)
  const [profiles, setProfiles] = useState<ProfileInfo[]>([{ id: 'auto', rootHints: [] }])
  /**
   * Metadata enrichment is an explicit, opt-in choice. Unchecked, the import is
   * deterministic and spends no model call at all.
   */
  const [enrich, setEnrich] = useState(false)
  /**
   * The scan poll stopped following this scan. The local status is flipped to
   * `failed` so the destructive Stop is not the only enabled control, but the
   * server row may still be walking — so the owner is offered a way back to
   * watching it rather than being told, permanently, that it ended.
   */
  const [pollGaveUp, setPollGaveUp] = useState(false)
  const [recentJobs, setRecentJobs] = useState<ImportJob[]>([])
  const [rollbackBusy, setRollbackBusy] = useState<string | null>(null)
  const [rollbackMsg, setRollbackMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /** Dates render in the language the owner picked, not the browser's. */
  const lang = useLanguageStore((s) => s.lang)

  const resetWizard = useCallback(() => {
    setStep('source')
    setProfile('auto')
    setPath('')
    setFile(null)
    setInstructions('')
    setScan(null)
    setWire(emptyWire())
    setResolvedCount(0)
    setError(null)
    setJob(null)
    setProposals([])
    setEnrich(false)
    setPollGaveUp(false)
    setRollbackMsg(null)
    setRollbackBusy(null)
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

  /**
   * The rollback line is a notice, not a status. Opening, closing or re-scanning
   * clears it, and so does time — otherwise a rollback started from the history
   * list would leave its message on the settings card for the whole session.
   */
  useEffect(() => {
    if (!rollbackMsg) return
    const timer = setTimeout(() => setRollbackMsg(null), 12000)
    return () => clearTimeout(timer)
  }, [rollbackMsg])

  /** Previous imports live on the card itself, so they load with the page. */
  const refreshJobs = useCallback(async () => {
    try {
      const res = await api.get<{ jobs: ImportJob[] }>('/data-port/import/jobs?limit=5')
      setRecentJobs(res.jobs ?? [])
    } catch {
      /* the card still works without a history list */
    }
  }, [])

  useEffect(() => {
    void refreshJobs()
  }, [refreshJobs])

  /** The adapter list is the server's; 'auto' is the UI's own first entry. */
  const loadProfiles = useCallback(async () => {
    try {
      const res = await api.get<{ profiles: ProfileInfo[] }>('/data-port/import/profiles')
      const fetched = (res.profiles ?? []).filter((p) => p && p.id && p.id !== 'auto')
      setProfiles([{ id: 'auto', rootHints: [] }, ...fetched.map((p) => ({ id: p.id, rootHints: p.rootHints ?? [] }))])
    } catch {
      setProfiles([{ id: 'auto', rootHints: [] }])
    }
  }, [])

  const handleOpen = () => {
    resetWizard()
    void loadProfiles()
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

  const scanId = scan?.scanId ?? null
  const scanStatus = scan?.status ?? null

  /**
   * P-9 — the path scan answers 202 and walks in the background, so the wizard
   * watches it. An upload is synchronous and arrives `done`, and this effect
   * simply never starts for it.
   */
  useEffect(() => {
    if (step !== 'scanning' || !scanId || scanStatus !== 'running') return
    let errors = 0
    // Giving up is still an ending. The step is left showing a scan that says
    // `running`, whose only enabled control is Stop — and Stop PURGES the rows,
    // so the owner's one way out would destroy the scan. Marking the scan
    // failed locally disables Stop, enables Review over whatever was mapped,
    // and the error line says what happened.
    const giveUp = () => {
      clearInterval(timer)
      setError(t('settings.dataPort.wizard.scanning.failed'))
      setPollGaveUp(true)
      setScan((prev) => (prev && prev.status === 'running' ? { ...prev, status: 'failed', progress: null } : prev))
    }
    const timer = setInterval(() => {
      void (async () => {
        try {
          const next = await api.get<ScanSummary>(`/data-port/import/scans/${encodeURIComponent(scanId)}`)
          errors = 0
          setPollGaveUp(false)
          setScan(next)
        } catch (err) {
          // A scan that is no longer there will never come back; anything else
          // gets a few more tries first.
          if (err instanceof ApiError && err.status === 404) return giveUp()
          if (++errors >= POLL_MAX_ERRORS) giveUp()
        }
      })()
    }, SCAN_POLL_MS)
    return () => clearInterval(timer)
  }, [step, scanId, scanStatus])

  const runScan = async () => {
    setScanning(true)
    setError(null)
    setRollbackMsg(null)
    // Cleared here rather than after the request lands: the Retry button belongs
    // to the scan that gave up, and leaving it on screen while a NEW scan is
    // being started invites a click that would retry nothing.
    setPollGaveUp(false)
    try {
      let result: ScanSummary
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
        result = data as ScanSummary
      } else if (path.trim()) {
        result = await api.post<ScanSummary>('/data-port/import/scan', {
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
      setWire(emptyWire())
      setResolvedCount(0)
      // An upload is already finished; a path scan has only just started.
      setStep(result.status === 'running' ? 'scanning' : 'review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }

  /**
   * Stops a scan that is still walking. `DELETE /scans/:id` purges the rows it
   * had mapped, so there is nothing left to review: the wizard goes back to the
   * source step rather than offering a Review button over an empty tree.
   */
  const cancelScan = async () => {
    if (!scan) return
    try {
      await api.delete(`/data-port/import/scans/${encodeURIComponent(scan.scanId)}`)
      setScan(null)
      setWire(emptyWire())
      setResolvedCount(0)
      // The scan it belonged to is gone, so the Retry button has nothing to
      // retry; without this it survived into the next scan's first poll.
      setPollGaveUp(false)
      setStep('source')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const startImport = async () => {
    if (!scan) return
    if (resolvedCount === 0) {
      setError(t('settings.dataPort.wizard.needSelection'))
      return
    }

    setError(null)
    setStep('running')
    try {
      const res = await api.post<{ job: ImportJob }>('/data-port/import/jobs', {
        scanId: scan.scanId,
        sourceProfile: scan.detectedProfile || profile,
        // P-10 — the folder/kind wire, never an id array.
        selection: wire,
        instructions: instructions.trim() || scan.instructions || undefined,
        // Omitted unless asked for: the server's default is a model-free import.
        ...(enrich ? { enrich: true } : {}),
      })
      setJob(res.job)
      let lastFingerprint = progressFingerprint(res.job)
      let lastProgressAt = Date.now()
      let consecutiveErrors = 0
      const stopPolling = () => {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
      }
      // Giving up is still an ending: the owner lands on the result step with
      // the last status we saw and a line telling them where to look next,
      // rather than watching a spinner that will never resolve.
      const giveUp = () => {
        stopPolling()
        setError(t('settings.dataPort.wizard.pollTimeout'))
        setStep('done')
        void refreshJobs()
      }
      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            const status = await api.get<{ job: ImportJob; proposals: WorkspaceProposal[] }>(
              `/data-port/import/jobs/${res.job.id}`,
            )
            consecutiveErrors = 0
            setJob(status.job)
            setProposals(status.proposals ?? [])
            if (TERMINAL_STATUSES.includes(status.job.status)) {
              stopPolling()
              setStep('done')
              void refreshJobs()
              return
            }
            // A moving job resets the clock; a silent one runs it down. Checked
            // only after the terminal test, so a job that finishes on its last
            // read is never mistaken for a stalled one.
            const fingerprint = progressFingerprint(status.job)
            if (fingerprint !== lastFingerprint) {
              lastFingerprint = fingerprint
              lastProgressAt = Date.now()
            } else if (Date.now() - lastProgressAt > POLL_NO_PROGRESS_MS) {
              giveUp()
            }
          } catch (err) {
            // A job that is no longer there will never come back; anything else
            // gets a few more tries before the poll calls it.
            if (err instanceof ApiError && err.status === 404) {
              giveUp()
              return
            }
            if (++consecutiveErrors >= POLL_MAX_ERRORS) giveUp()
          }
        })()
      }, POLL_INTERVAL_MS)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('review')
    }
  }

  /** Stops an import at the next batch boundary; everything already filed stays. */
  const cancelImport = async () => {
    if (!job) return
    if (!window.confirm(t('settings.dataPort.wizard.cancelImportConfirm'))) return
    try {
      await api.post(`/data-port/import/jobs/${job.id}/cancel`, {})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const approveProposal = async (id: string) => {
    try {
      await api.post(`/data-port/proposals/${id}/approve`)
      setProposals((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'approved' } : p)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const rejectProposal = async (id: string) => {
    try {
      await api.post(`/data-port/proposals/${id}/reject`)
      setProposals((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'rejected' } : p)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Undo a whole import. Everything it created is removed — the confirm is the
   * only guard, so it names what disappears rather than asking "are you sure".
   */
  const rollbackImport = async (jobId: string) => {
    if (!window.confirm(t('settings.dataPort.wizard.rollbackConfirm'))) return
    setRollbackBusy(jobId)
    setRollbackMsg(null)
    try {
      const res = await api.post<{ result?: RollbackResult }>(`/data-port/import/jobs/${jobId}/rollback`)
      setRollbackMsg(t('settings.dataPort.wizard.rollbackDone', { count: rollbackCount(res?.result) }))
      await refreshJobs()
      if (job && job.id === jobId) {
        try {
          const status = await api.get<{ job: ImportJob; proposals: WorkspaceProposal[] }>(
            `/data-port/import/jobs/${jobId}`,
          )
          setJob(status.job)
          setProposals(status.proposals ?? [])
        } catch {
          /* the rollback itself succeeded; the refresh is cosmetic */
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRollbackBusy(null)
    }
  }

  const activeProfile = useMemo(() => profiles.find((p) => p.id === profile) ?? null, [profiles, profile])

  const summary = job ? progressSummary(job, Date.now()) : null
  const byKind = Object.entries(job?.stats?.byKind ?? {}).filter(([, n]) => n > 0)

  return (
    <>
      <div className="glass-card p-4">
        <h3 className="text-sm font-semibold mb-1 inline-flex items-center gap-1.5">
          {t('settings.dataPort.heading')}
          <ContextualHelp helpId="admin.data-port" />
        </h3>
        <p className="text-xs text-muted-foreground mb-3">{t('settings.dataPort.subtitle')}</p>
        <div className="flex flex-col gap-2">
          <Button size="sm" className="justify-start" onClick={handleOpen}>
            <Download className="h-3.5 w-3.5 mr-2" />
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
            <Upload className="h-3.5 w-3.5 mr-2" />
            {t('settings.dataPort.export')}
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {t('settings.dataPort.comingSoon')}
            </Badge>
          </Button>
        </div>
        {exportBusy ? null : null}

        {recentJobs.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold mb-2">{t('settings.dataPort.previousImports')}</p>
            <div className="flex flex-col gap-1.5">
              {recentJobs.map((j) => (
                <div
                  key={j.id}
                  className="flex items-center gap-2 flex-wrap rounded-md border border-border/50 px-2.5 py-1.5"
                >
                  <span className="text-[11px] text-muted-foreground">
                    {j.createdAt ? formatDateTime(j.createdAt, lang) : '—'}
                  </span>
                  <span className="text-[11px] font-medium">
                    {tOr(`settings.dataPort.profile.${j.sourceProfile}`, j.sourceProfile)}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {tOr(`settings.dataPort.wizard.status.${j.status}`, j.status)}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {t('settings.dataPort.wizard.stat.applied')}: {j.stats?.applied ?? 0}
                  </span>
                  {ROLLBACKABLE_STATUSES.includes(j.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-7 text-[11px] px-2 text-destructive hover:text-destructive"
                      disabled={rollbackBusy === j.id}
                      onClick={() => rollbackImport(j.id)}
                    >
                      {rollbackBusy === j.id ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Undo2 className="h-3 w-3 mr-1" />
                      )}
                      {t('settings.dataPort.wizard.rollback')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {rollbackMsg && !open && <p className="text-[11px] text-muted-foreground mt-1.5">{rollbackMsg}</p>}
            {error && !open && <p className="text-[11px] text-destructive mt-1.5">{error}</p>}
          </div>
        )}
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
            <p className="text-[11px] text-muted-foreground font-normal">{t('settings.dataPort.wizard.resizeHint')}</p>
          </DialogHeader>

          {error && (
            <div className="shrink-0 text-sm text-destructive flex items-start gap-2 bg-destructive/10 rounded-md p-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* The review step owns its own scrollbars, so the body only scrolls
              for the steps that are a document rather than two panes. */}
          <div
            className={`flex-1 min-h-0 flex flex-col gap-3 pr-1 ${
              step === 'review' ? 'overflow-hidden' : 'overflow-y-auto'
            }`}
          >
            {step === 'source' && (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-sm font-medium mb-2">{t('settings.dataPort.wizard.sourceProfile')}</p>
                  <div className="flex flex-wrap gap-1">
                    {profiles.map((p) => (
                      <Button
                        key={p.id}
                        size="sm"
                        variant={profile === p.id ? 'secondary' : 'ghost'}
                        onClick={() => setProfile(p.id)}
                      >
                        {tOr(`settings.dataPort.profile.${p.id}`, p.id)}
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
                  <p className="text-xs text-muted-foreground mb-2">{t('settings.dataPort.wizard.pathHint')}</p>
                  <input
                    aria-label={t('settings.dataPort.wizard.pathLabel')}
                    className="w-full bg-transparent border border-border-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="/path/to/previous/assistant"
                    value={path}
                    onChange={(e) => {
                      setPath(e.target.value)
                      if (e.target.value) setFile(null)
                    }}
                    disabled={!!file}
                  />
                  {activeProfile && activeProfile.rootHints.length > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {t('settings.dataPort.rootHints')}: {activeProfile.rootHints.join(' · ')}
                    </p>
                  )}
                </div>

                <div className="text-xs text-muted-foreground text-center">{t('settings.dataPort.wizard.or')}</div>

                <div>
                  <p className="text-sm font-medium mb-1 flex items-center gap-1.5">
                    <FileArchive className="h-3.5 w-3.5" />
                    {t('settings.dataPort.wizard.uploadLabel')}
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">{t('settings.dataPort.wizard.uploadHint')}</p>
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
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={!!path.trim()}>
                    {file ? file.name : t('settings.dataPort.wizard.chooseFile')}
                  </Button>
                  {file && (
                    <Button size="sm" variant="ghost" className="ml-2" onClick={() => setFile(null)}>
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
                  <p className="text-xs text-muted-foreground mb-2">{t('settings.dataPort.wizard.instructionsHint')}</p>
                  <textarea
                    aria-label={t('settings.dataPort.wizard.instructionsLabel')}
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

            {step === 'scanning' && scan && (
              <div className="flex flex-col items-center gap-2 py-8">
                {scan.status === 'running' && <Loader2 className="h-7 w-7 animate-spin text-primary" />}
                <p className="text-sm font-medium">{t('settings.dataPort.wizard.scanning.title')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('settings.dataPort.wizard.scanning.dirs', {
                    count: scan.progress?.dirsVisited ?? scan.stats.dirsVisited,
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('settings.dataPort.wizard.scanning.files', {
                    count: scan.progress?.filesSeen ?? scan.stats.filesScanned,
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('settings.dataPort.wizard.scanning.candidates', {
                    count: scan.progress?.candidates ?? scan.stats.candidateCount,
                  })}
                </p>
                {scan.progress?.currentDir && (
                  <p className="max-w-full truncate font-mono text-[11px] text-muted-foreground">
                    {t('settings.dataPort.wizard.scanning.current', { dir: scan.progress.currentDir })}
                  </p>
                )}
                {scan.status === 'failed' && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t('settings.dataPort.wizard.scanning.failed')}
                  </p>
                )}
                {pollGaveUp && (
                  // The scan may well still be walking on the server; one blip
                  // must not stop the wizard following it for the rest of the
                  // session, and Review over a half-mapped tree is not the only
                  // thing the owner might want.
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPollGaveUp(false)
                      setError(null)
                      setScan((prev) => (prev ? { ...prev, status: 'running' } : prev))
                    }}
                  >
                    {tc('common.retry')}
                  </Button>
                )}
                {scan.warnings.length > 0 && (
                  <ul className="list-disc pl-4 text-xs text-amber-600 dark:text-amber-400">
                    {scan.warnings.map((w, i) => (
                      <li key={typeof w === 'string' ? `${i}-${w}` : `${i}-${w.code}`}>{scanWarningText(w)}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {step === 'review' && scan && (
              <DataPortReview
                scan={scan}
                wire={wire}
                onWireChange={setWire}
                onResolvedCount={setResolvedCount}
                enrich={enrich}
                onEnrichChange={setEnrich}
                lang={lang}
              />
            )}

            {step === 'running' && job && summary && (
              <div className="flex flex-col gap-3 py-6">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <p className="text-sm font-medium">{t('settings.dataPort.wizard.running')}</p>
                  <Badge variant="outline" className="text-[10px]">
                    {tOr(`settings.dataPort.wizard.phase.${job.phase}`, job.phase)}
                  </Badge>
                </div>
                {(job.stats?.resumed ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground">{t('settings.dataPort.wizard.resumeNotice')}</p>
                )}
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={summary.pct}
                  aria-label={t('settings.dataPort.wizard.running')}
                  className="h-2 w-full overflow-hidden rounded-full bg-accent"
                >
                  <div className="h-full bg-primary transition-all" style={{ width: `${summary.pct}%` }} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {t('settings.dataPort.wizard.progress.items', {
                      processed: summary.processed,
                      total: summary.total,
                    })}
                  </span>
                  <span>{t('settings.dataPort.wizard.progress.elapsed', { time: formatDuration(summary.elapsedMs) })}</span>
                  <span>
                    {summary.etaMs === null
                      ? t('settings.dataPort.wizard.progress.etaUnknown')
                      : t('settings.dataPort.wizard.progress.eta', { time: formatDuration(summary.etaMs) })}
                  </span>
                  <span>{t('settings.dataPort.wizard.progress.rate', { rate: summary.ratePerMin })}</span>
                </div>
                {byKind.length > 0 && (
                  <div>
                    <p className="text-xs font-medium">{t('settings.dataPort.wizard.progress.byKind')}</p>
                    <ul className="text-[11px] text-muted-foreground">
                      {byKind.map(([k, n]) => (
                        <li key={k}>
                          {kindLabel(k)} — {n}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <Button size="sm" variant="destructive" onClick={cancelImport}>
                    {t('settings.dataPort.wizard.cancelImport')}
                  </Button>
                </div>
              </div>
            )}

            {step === 'done' && job && summary && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  {job.status === 'rolled_back' ? (
                    <Undo2 className="h-5 w-5 text-muted-foreground" />
                  ) : job.status === 'completed' ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                  )}
                  <p className="text-sm font-medium">
                    {job.status === 'rolled_back'
                      ? t('settings.dataPort.wizard.rolledBackTitle')
                      : job.status === 'completed'
                        ? t('settings.dataPort.wizard.done')
                        : // A job we stopped polling has not failed — it is still
                          // marked running server-side. Calling it "failed" next
                          // to a "Running" badge would contradict itself; the
                          // error line above already says what happened.
                          TERMINAL_STATUSES.includes(job.status)
                          ? t('settings.dataPort.wizard.failed')
                          : t('settings.dataPort.wizard.running')}
                  </p>
                  <Badge variant="outline" className="text-[10px]">
                    {tOr(`settings.dataPort.wizard.status.${job.status}`, job.status)}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                  {(
                    [
                      ['applied', job.stats?.applied],
                      ['unchanged', job.stats?.unchanged],
                      ['proposals', job.stats?.proposals],
                      ['skipped', job.stats?.skipped],
                      ['errors', job.stats?.errors],
                      ['total', job.stats?.total],
                    ] as const
                  ).map(([key, val]) => (
                    <div key={key} className="rounded-lg bg-accent/40 p-2">
                      <div className="text-lg font-semibold">{val ?? 0}</div>
                      <div className="text-[10px] text-muted-foreground">{t(`settings.dataPort.wizard.stat.${key}`)}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <p className="text-xs font-medium">{t('settings.dataPort.wizard.stat.elapsed')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.dataPort.wizard.importTime', {
                      time: formatDuration(job.importMs ?? summary.elapsedMs),
                    })}
                  </p>
                  {scan && (
                    <p className="text-xs text-muted-foreground">
                      {t('settings.dataPort.wizard.scanTime', { time: formatDuration(scan.stats.scanMs) })}
                    </p>
                  )}
                  {(job.stats?.resumed ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t('settings.dataPort.wizard.stat.resumed')}: {job.stats.resumed}
                    </p>
                  )}
                </div>

                {byKind.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-1">{t('settings.dataPort.wizard.progress.byKind')}</p>
                    <ul className="text-xs text-muted-foreground flex flex-col gap-0.5">
                      {byKind.map(([k, n]) => (
                        <li key={k}>
                          {kindLabel(k)} — {n}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(job.stats?.aiEnriched ?? 0) + (job.stats?.aiFallback ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('settings.dataPort.wizard.aiSummary', {
                      enriched: job.stats.aiEnriched ?? 0,
                      fallback: job.stats.aiFallback ?? 0,
                    })}
                  </p>
                )}

                {Object.keys(job.stats?.skippedReasons ?? {}).length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-1">{t('settings.dataPort.wizard.skippedReasons')}</p>
                    <ul className="text-xs text-muted-foreground flex flex-col gap-0.5">
                      {Object.entries(job.stats.skippedReasons ?? {})
                        .sort((a, b) => b[1] - a[1])
                        .map(([code, count]) => (
                          <li key={code}>
                            {reasonLabel(code, code)} — {count}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {scan && scan.warnings.length > 0 && (
                  <ul className="list-disc pl-4 text-xs text-amber-600 dark:text-amber-400">
                    {scan.warnings.map((w, i) => (
                      <li key={typeof w === 'string' ? `${i}-${w}` : `${i}-${w.code}`}>{scanWarningText(w)}</li>
                    ))}
                  </ul>
                )}

                {job.error && <p className="text-sm text-destructive">{job.error}</p>}

                {proposals.filter((p) => p.status === 'pending').length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">{t('settings.dataPort.wizard.proposalsHeading')}</p>
                    <p className="text-xs text-muted-foreground mb-2">{t('settings.dataPort.wizard.proposalsHint')}</p>
                    <div className="flex flex-col gap-2">
                      {proposals
                        .filter((p) => p.status === 'pending')
                        .map((p) => (
                          <div key={p.id} className="border border-border/50 rounded-lg p-3 flex flex-col gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{p.title}</span>
                              <Badge variant="outline" className="text-[10px]">
                                {proposalFileLabel(p)}
                              </Badge>
                              <Badge variant="secondary" className="text-[10px]">
                                {proposalAgentLabel(p)}
                              </Badge>
                            </div>
                            {p.workspaceFile === 'AGENTS.md' && (
                              <p className="text-[11px] text-muted-foreground">
                                {t('settings.dataPort.wizard.agentsWindowHint')}
                              </p>
                            )}
                            <pre className="text-[11px] text-muted-foreground bg-accent/30 rounded p-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
                              {p.proposedBody.slice(0, 2000)}
                            </pre>
                            <div className="flex gap-2 justify-end">
                              <Button size="sm" variant="ghost" onClick={() => rejectProposal(p.id)}>
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

                {ROLLBACKABLE_STATUSES.includes(job.status) && (
                  <div className="flex items-center gap-3 flex-wrap border-t border-border/40 pt-3">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={rollbackBusy === job.id}
                      onClick={() => rollbackImport(job.id)}
                    >
                      {rollbackBusy === job.id && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                      <Undo2 className="h-3.5 w-3.5 mr-1" />
                      {t('settings.dataPort.wizard.rollback')}
                    </Button>
                    {rollbackMsg && <span className="text-xs text-muted-foreground">{rollbackMsg}</span>}
                  </div>
                )}
                {!ROLLBACKABLE_STATUSES.includes(job.status) && rollbackMsg && (
                  <p className="text-xs text-muted-foreground">{rollbackMsg}</p>
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
            {step === 'scanning' && scan && (
              <>
                <Button variant="ghost" onClick={cancelScan} disabled={scan.status !== 'running'}>
                  {t('settings.dataPort.wizard.scanning.cancel')}
                </Button>
                <Button onClick={() => setStep('review')} disabled={scan.status === 'running'}>
                  {t('settings.dataPort.wizard.scanning.continue')}
                </Button>
              </>
            )}
            {step === 'review' && (
              <>
                <Button variant="ghost" onClick={() => setStep('source')}>
                  {t('settings.dataPort.wizard.back')}
                </Button>
                <Button onClick={startImport} disabled={resolvedCount === 0}>
                  {t('settings.dataPort.wizard.startImport', { count: resolvedCount })}
                </Button>
              </>
            )}
            {step === 'done' && <Button onClick={() => setOpen(false)}>{tc('common.close')}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
