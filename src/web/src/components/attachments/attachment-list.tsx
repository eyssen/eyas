import { useEffect } from 'react'
import {
  File,
  FileText,
  FileArchive,
  FileCode,
  Image,
  Film,
  Download,
  X,
  Cloud,
  Clock,
  AlertCircle,
  CloudOff,
  Paperclip,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDocumentsStore, type DocumentRecord, type DocumentLink, type DocumentSource } from '@/stores/documents-store'
import { formatBytes } from '@/pages/documents/document-card'
import { UploadZone } from '@/pages/documents/upload-zone'

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

function SyncIcon({ status }: { status: DocumentRecord['remoteStatus'] }) {
  if (status === 'synced')
    return <Cloud className="h-3 w-3 text-green-500 flex-shrink-0" />
  if (status === 'pending')
    return <Clock className="h-3 w-3 text-yellow-500 flex-shrink-0" />
  if (status === 'error')
    return <AlertCircle className="h-3 w-3 text-destructive flex-shrink-0" />
  return <CloudOff className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
}

function SourceBadge({ source }: { source: DocumentSource }) {
  if (source === 'ai') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 text-purple-500 flex-shrink-0">
        AI
      </span>
    )
  }
  if (source === 'user') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/15 text-blue-500 flex-shrink-0">
        User
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground flex-shrink-0">
      System
    </span>
  )
}

function formatLinkDate(isoDate: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(isoDate))
  } catch {
    return isoDate
  }
}

interface AttachmentListProps {
  ownerModule: string
  ownerId: string
  className?: string
  variant?: 'compact' | 'full'
}

export function AttachmentList({ ownerModule, ownerId, className, variant = 'compact' }: AttachmentListProps) {
  const { documents, fetchDocuments, unlinkDocument } = useDocumentsStore()

  useEffect(() => {
    fetchDocuments({ ownerModule, ownerId })
  }, [fetchDocuments, ownerModule, ownerId])

  const attachments: Array<{ doc: DocumentRecord; link: DocumentLink }> = documents
    .filter(d => !d.deletedAt)
    .flatMap(d => {
      const link = (d.links ?? []).find(l => l.ownerModule === ownerModule && l.ownerId === ownerId)
      return link ? [{ doc: d, link }] : []
    })

  if (variant === 'full') {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        {/* Attachment list */}
        <div className="flex-1 overflow-y-auto">
          {attachments.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
              <Paperclip className="h-8 w-8 opacity-25" />
              <span className="text-sm">No attachments yet</span>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border/50">
              {attachments.map(({ doc, link }) => {
                const FileIcon = getFileIcon(doc.mimeType)
                return (
                  <div
                    key={doc.id}
                    className="group flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
                  >
                    <FileIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />

                    {/* Filename */}
                    <span className="text-[13px] text-foreground truncate flex-1 min-w-0">{doc.filename}</span>

                    {/* Size */}
                    <span className="text-[11px] text-muted-foreground flex-shrink-0 w-14 text-right">
                      {formatBytes(doc.sizeBytes)}
                    </span>

                    {/* Source badge */}
                    <SourceBadge source={link.source} />

                    {/* Date */}
                    <span className="text-[11px] text-muted-foreground flex-shrink-0 w-24 text-right">
                      {formatLinkDate(link.createdAt)}
                    </span>

                    {/* Sync status */}
                    <SyncIcon status={doc.remoteStatus} />

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <a
                        href={`/api/v1/documents/${doc.id}/download`}
                        download={doc.filename}
                        title="Download"
                        className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                      <button
                        type="button"
                        title="Remove from conversation"
                        onClick={() => unlinkDocument(doc.id, ownerModule, ownerId)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Upload zone at the bottom */}
        <div className="border-t border-border/50 p-3 flex-shrink-0">
          <UploadZone ownerModule={ownerModule} ownerId={ownerId} compact />
        </div>
      </div>
    )
  }

  // compact variant (default — original behavior)
  if (attachments.length === 0) return null

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {attachments.map(({ doc, link: _link }) => {
        const FileIcon = getFileIcon(doc.mimeType)
        return (
          <div
            key={doc.id}
            className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent/50 transition-colors"
          >
            <FileIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-[12px] text-foreground truncate flex-1">{doc.filename}</span>
            <span className="text-[11px] text-muted-foreground flex-shrink-0">
              {formatBytes(doc.sizeBytes)}
            </span>
            <SyncIcon status={doc.remoteStatus} />
            <a
              href={`/api/v1/documents/${doc.id}/download`}
              download={doc.filename}
              title="Download"
              className="hidden group-hover:flex p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
              onClick={e => e.stopPropagation()}
            >
              <Download className="h-3 w-3" />
            </a>
            <button
              type="button"
              title="Remove attachment"
              onClick={() => unlinkDocument(doc.id, ownerModule, ownerId)}
              className="hidden group-hover:flex p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
