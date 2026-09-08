// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useMemo, useState, useEffect } from 'react'
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FileText, Package, History, Link2, RefreshCw } from 'lucide-react'
import { t } from './i18n'

// ─── Types mirrored from backend ───

type ArtifactKind =
  | 'prd'
  | 'design-doc'
  | 'task-list'
  | 'code-diff'
  | 'test-plan'
  | 'deploy-manifest'

interface Artifact {
  id: string
  sessionId: string | null
  kind: ArtifactKind
  title: string
  currentVersion: number
  producedBy: string | null
  consumedBy: string[]
  createdAt: number
  updatedAt: number
  payload?: unknown
}

interface ArtifactVersion {
  id: number
  artifactId: string
  version: number
  payload: unknown
  createdAt: number
  createdBy: string | null
  changeNote: string | null
}

// Kind label is resolved with t() at render time so it follows the active language.
const kindLabel = (kind: ArtifactKind): string => t(`artifacts.kind.${kind}`)

// TODO: Replace JsonRenderer with kind-specific specialized renderers
// (PrdRenderer, DesignDocRenderer, TaskListRenderer, CodeDiffRenderer, etc.)
// For MVP we just pretty-print the payload as JSON.

interface ArtifactViewerProps {
  artifactId: string
}

export default function ArtifactViewer({ artifactId }: ArtifactViewerProps) {
  const { data: artifact, refetch } = useApi<Artifact>(`/artifacts/${artifactId}`)
  const { data: versions, refetch: refetchVersions } =
    useApi<ArtifactVersion[]>(`/artifacts/${artifactId}/versions`)
  const { data: backlinks } = useApi<Artifact[]>(`/artifacts/${artifactId}/backlinks`)

  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)

  useEffect(() => {
    if (artifact && selectedVersion === null) {
      setSelectedVersion(artifact.currentVersion)
    }
  }, [artifact, selectedVersion])

  const activePayload = useMemo(() => {
    if (!artifact) return null
    if (selectedVersion === null || selectedVersion === artifact.currentVersion) {
      return artifact.payload ?? null
    }
    const v = versions?.find((x) => x.version === selectedVersion)
    return v?.payload ?? null
  }, [artifact, versions, selectedVersion])

  if (!artifact) {
    return (
      <div className="p-6 text-sm text-muted-foreground">{t('artifacts.loading')}</div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Meta header */}
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-muted p-2">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{artifact.title}</h1>
              <Badge variant="secondary">{kindLabel(artifact.kind)}</Badge>
              <Badge variant="outline">v{artifact.currentVersion}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {artifact.producedBy && (
                <span>
                  <strong>{t('artifacts.producedBy')}</strong> {artifact.producedBy}
                </span>
              )}
              {artifact.sessionId && (
                <span>
                  <strong>{t('artifacts.session')}</strong> {artifact.sessionId}
                </span>
              )}
              <span>
                <strong>{t('artifacts.created')}</strong>{' '}
                {new Date(artifact.createdAt).toLocaleString()}
              </span>
              <span>
                <strong>{t('artifacts.updated')}</strong>{' '}
                {new Date(artifact.updatedAt).toLocaleString()}
              </span>
            </div>
            {artifact.consumedBy.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
                <span className="text-muted-foreground">{t('artifacts.consumedBy')}</span>
                {artifact.consumedBy.map((c) => (
                  <Badge key={c} variant="outline">
                    <Package className="mr-1 h-3 w-3" />
                    {c}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refetch()
            refetchVersions()
          }}
        >
          <RefreshCw className="mr-1 h-3 w-3" /> {t('common.refresh')}
        </Button>
      </div>

      {/* Version switcher */}
      {versions && versions.length > 1 && (
        <div className="flex items-center gap-2 rounded-lg border p-2 text-sm">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">{t('artifacts.versions')}</span>
          {versions.map((v) => (
            <button
              key={v.version}
              type="button"
              className={`rounded px-2 py-1 text-xs ${
                selectedVersion === v.version
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/70'
              }`}
              onClick={() => setSelectedVersion(v.version)}
              title={v.changeNote ?? undefined}
            >
              v{v.version}
            </button>
          ))}
        </div>
      )}

      {/* Payload — MVP: JSON renderer; TODO kind-specific specialised views */}
      <div className="rounded-lg border">
        <div className="border-b px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          {t('artifacts.payload', { version: selectedVersion ?? artifact.currentVersion })}
        </div>
        <PayloadRenderer kind={artifact.kind} payload={activePayload} />
      </div>

      {/* Backlinks */}
      {backlinks && backlinks.length > 0 && (
        <div className="rounded-lg border p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Link2 className="h-4 w-4" />
            {t('artifacts.referencedBy', { count: backlinks.length })}
          </div>
          <ul className="space-y-1 text-sm">
            {backlinks.map((b) => (
              <li key={b.id} className="flex items-center gap-2">
                <Badge variant="secondary">{kindLabel(b.kind)}</Badge>
                <span>{b.title}</span>
                <span className="text-xs text-muted-foreground">
                  v{b.currentVersion}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── Renderers ─────────────────────────────────────────────

function PayloadRenderer({
  kind,
  payload,
}: {
  kind: ArtifactKind
  payload: unknown
}) {
  // TODO: branch on `kind` and use specialised renderers for richer UX.
  // For now we render a pretty-printed JSON block for every kind.
  void kind
  const serialised = useMemo(() => {
    try {
      return JSON.stringify(payload ?? null, null, 2)
    } catch {
      return String(payload)
    }
  }, [payload])

  return (
    <pre className="max-h-[60vh] overflow-auto rounded-b-lg bg-muted/40 p-4 text-xs leading-relaxed">
      <code>{serialised}</code>
    </pre>
  )
}
