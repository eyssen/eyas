import { useState } from 'react'
import {
  File,
  FileText,
  FileArchive,
  FileCode,
  Image,
  Film,
  Trash2,
  Cloud,
  Clock,
  AlertCircle,
  CloudOff,
  Download,
  Link2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DocumentRecord } from '@/stores/documents-store'
import { useDocumentsStore } from '@/stores/documents-store'
import { t } from './i18n'

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const value = bytes / Math.pow(k, i)
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${sizes[i]}`
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return Image
  if (mimeType === 'application/pdf') return FileText
  if (
    mimeType === 'application/zip' ||
    mimeType === 'application/x-tar' ||
    mimeType === 'application/x-gzip' ||
    mimeType === 'application/x-7z-compressed' ||
    mimeType === 'application/x-rar-compressed'
  )
    return FileArchive
  if (
    mimeType === 'application/json' ||
    mimeType === 'application/javascript' ||
    mimeType === 'application/typescript' ||
    mimeType.includes('xml') ||
    mimeType.includes('html') ||
    mimeType.includes('css')
  )
    return FileCode
  if (mimeType.startsWith('video/')) return Film
  return File
}

function SyncBadge({ status }: { status: DocumentRecord['remoteStatus'] }) {
  if (status === 'synced') {
    return (
      <span title={t('documents.sync.synced')} className="text-green-500">
        <Cloud className="h-3.5 w-3.5" />
      </span>
    )
  }
  if (status === 'pending') {
    return (
      <span title={t('documents.sync.pending')} className="text-yellow-500">
        <Clock className="h-3.5 w-3.5" />
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span title={t('documents.sync.error')} className="text-destructive">
        <AlertCircle className="h-3.5 w-3.5" />
      </span>
    )
  }
  return (
    <span title={t('documents.sync.notConfigured')} className="text-muted-foreground/50">
      <CloudOff className="h-3.5 w-3.5" />
    </span>
  )
}

interface DocumentCardProps {
  doc: DocumentRecord
  className?: string
}

export function DocumentCard({ doc, className }: DocumentCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { deleteDocument } = useDocumentsStore()
  const FileIcon = getFileIcon(doc.mimeType)
  const linkCount = doc.links?.length ?? 0

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    await deleteDocument(doc.id)
  }

  return (
    <div
      className={cn(
        'group relative flex flex-col gap-2 p-3 rounded-xl border border-[var(--vibrancy-border)] bg-muted/30 hover:bg-accent/50 transition-colors',
        className
      )}
      onMouseLeave={() => setConfirmDelete(false)}
    >
      {/* Icon + sync badge */}
      <div className="flex items-start justify-between">
        <FileIcon className="h-8 w-8 text-muted-foreground" />
        <SyncBadge status={doc.remoteStatus} />
      </div>

      {/* Filename */}
      <p className="text-[13px] font-medium text-foreground line-clamp-2 leading-snug break-all">
        {doc.filename}
      </p>

      {/* Size + link count */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">{formatBytes(doc.sizeBytes)}</p>
        {linkCount > 0 ? (
          <span
            title={t('documents.usedIn', { count: linkCount })}
            className="flex items-center gap-0.5 text-[11px] text-muted-foreground"
          >
            <Link2 className="h-3 w-3" />
            {linkCount}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/50">{t('documents.unlinked')}</span>
        )}
      </div>

      {/* Actions — shown on hover */}
      <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1">
        <a
          href={`/api/v1/documents/${doc.id}/download`}
          download={doc.filename}
          title={t('documents.download')}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          onClick={e => e.stopPropagation()}
        >
          <Download className="h-3.5 w-3.5" />
        </a>
        <button
          type="button"
          title={confirmDelete ? t('documents.deleteConfirm') : t('documents.delete')}
          onClick={handleDelete}
          className={cn(
            'p-1 rounded-md transition-colors',
            confirmDelete
              ? 'text-destructive bg-destructive/10'
              : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
