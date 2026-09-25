// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The files a message carries — what the user attached, and what the agent
// produced during that turn.
//
// The previous version rendered every attachment as an `<img>` and hid it on
// error. An image survived that; an HTML page, a PDF or a CSV became an
// invisible broken image, which is why an agent could write a file, register
// it correctly, and still leave no trace anywhere the user looks. Anything
// that is not an image is a chip now: name, size, and a link that opens it.

import { useEffect } from 'react'
import { FileText, Image as ImageIcon, FileType2, Table2 } from 'lucide-react'
import { useDocumentsStore } from '@/stores/documents-store'
import { t } from './i18n'

function iconFor(mime: string, filename: string) {
  if (mime.startsWith('image/')) return ImageIcon
  if (mime === 'application/pdf' || filename.endsWith('.pdf')) return FileType2
  if (mime === 'text/csv' || filename.endsWith('.csv')) return Table2
  return FileText
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function MessageAttachments({
  attachmentIds,
  conversationId,
}: {
  attachmentIds: string[]
  conversationId: string
}) {
  const documents = useDocumentsStore((s) => s.documents)
  const fetchDocuments = useDocumentsStore((s) => s.fetchDocuments)

  // The panel usually filled this already; fetching again is cheap and makes
  // the chips work on a page opened straight to a conversation.
  useEffect(() => {
    if (attachmentIds.some((id) => !documents.find((d) => d.id === id))) {
      void fetchDocuments({ ownerModule: 'conversations', ownerId: conversationId })
    }
    // Only when the set of ids changes — not on every store update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentIds.join(','), conversationId])

  if (attachmentIds.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 mb-1.5">
      {attachmentIds.map((docId) => {
        const doc = documents.find((d) => d.id === docId)
        const href = `/api/v1/documents/${docId}/download`
        const isImage = doc?.mimeType?.startsWith('image/') ?? false

        if (isImage) {
          return (
            <a key={docId} href={href} target="_blank" rel="noreferrer">
              <img
                src={href}
                className="max-h-48 rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                alt={doc?.filename ?? t('conversations.messages.attachmentAlt')}
              />
            </a>
          )
        }

        const Icon = iconFor(doc?.mimeType ?? '', doc?.filename ?? '')
        return (
          <a
            key={docId}
            href={href}
            target="_blank"
            rel="noreferrer"
            title={t('conversations.messages.openAttachment')}
            className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-xs hover:bg-accent/50 transition-colors max-w-full"
          >
            <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="truncate">{doc?.filename ?? t('conversations.messages.attachmentAlt')}</span>
            {doc && <span className="shrink-0 text-[10px] text-muted-foreground">{humanSize(doc.sizeBytes)}</span>}
          </a>
        )
      })}
    </div>
  )
}
