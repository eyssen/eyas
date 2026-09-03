import { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowUp, Paperclip, Loader2, X, FileText, Wand2, Map } from 'lucide-react'
import { api } from '@/lib/api'
import { useDocumentsStore, type DocumentRecord } from '@/stores/documents-store'
import { PromptEnhancerDialog } from './components/prompt-enhancer-dialog'
import {
  GodModeBanner,
  GodModeConfirmDialog,
  shouldConfirmGodSend,
  useGodModeEstimate,
} from './god-mode-banner'
import { t } from './i18n'

interface PendingAttachment {
  id: string
  /** Present for files uploaded through this input. Absent for documents linked
   *  in from elsewhere (e.g. carried over by the Prompt Enhancer). */
  file?: File
  filename: string
  mimeType: string
  preview: string
  status: 'uploading' | 'done' | 'error'
  documentId?: string
}

interface ConversationInputProps {
  onSend: (content: string, attachmentIds?: string[], opts?: { plan?: boolean }) => void
  disabled: boolean
  conversationId: string
  /** Parent conversation model selection — used to optimize Prompt Enhancer output. */
  providerId?: string | null
  modelId?: string | null
  godMode?: boolean
  conversationStatus?: string
  workingDirectories?: unknown
}

export function ConversationInput({
  onSend,
  disabled,
  conversationId,
  providerId,
  modelId,
  godMode = false,
  conversationStatus,
  workingDirectories,
}: ConversationInputProps) {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [enhancerOpen, setEnhancerOpen] = useState(false)
  const [hasConfirmedGod, setHasConfirmedGod] = useState(false)
  const [planMode, setPlanMode] = useState(false)
  const [godConfirmOpen, setGodConfirmOpen] = useState(false)
  const [godGateMessage, setGodGateMessage] = useState<'ceiling' | 'config' | 'busy' | null>(null)
  const { uploadFile } = useDocumentsStore()
  const { data: godEstimate, error: godEstimateError } = useGodModeEstimate(conversationId, godMode)

  const isUploading = attachments.some(a => a.status === 'uploading')

  const addFiles = useCallback(async (files: File[]) => {
    const newAttachments: PendingAttachment[] = files.map(file => ({
      id: crypto.randomUUID(),
      file,
      filename: file.name,
      mimeType: file.type,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      status: 'uploading' as const,
    }))

    setAttachments(prev => [...prev, ...newAttachments])

    for (const att of newAttachments) {
      const doc = await uploadFile(att.file!, 'conversations', conversationId, 'user')
      setAttachments(prev =>
        prev.map(a =>
          a.id === att.id
            ? doc
              ? { ...a, status: 'done' as const, documentId: doc.id }
              : { ...a, status: 'error' as const }
            : a
        )
      )
    }
  }, [uploadFile, conversationId])

  /** Attach already-uploaded documents by ID (e.g. carried over by the Prompt
   *  Enhancer). Only links metadata — no re-upload. */
  const addLinkedDocuments = useCallback(async (docIds: string[]) => {
    if (docIds.length === 0) return
    const placeholders: PendingAttachment[] = docIds.map(id => ({
      id: crypto.randomUUID(),
      filename: '…',
      mimeType: '',
      preview: '',
      status: 'uploading' as const,
      documentId: id,
    }))
    setAttachments(prev => [...prev, ...placeholders])

    await Promise.all(placeholders.map(async (ph) => {
      try {
        const doc = await api.get<DocumentRecord>(`/documents/${ph.documentId}`)
        setAttachments(prev => prev.map(a =>
          a.id === ph.id
            ? {
                ...a,
                filename: doc.filename,
                mimeType: doc.mimeType,
                status: 'done' as const,
              }
            : a
        ))
      } catch {
        setAttachments(prev => prev.map(a =>
          a.id === ph.id ? { ...a, status: 'error' as const } : a
        ))
      }
    }))
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => {
      const att = prev.find(a => a.id === id)
      if (att?.preview) URL.revokeObjectURL(att.preview)
      return prev.filter(a => a.id !== id)
    })
  }, [])

  // Cleanup previews on unmount
  useEffect(() => {
    return () => {
      attachments.forEach(a => { if (a.preview) URL.revokeObjectURL(a.preview) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setHasConfirmedGod(false)
    setGodConfirmOpen(false)
    setGodGateMessage(null)
  }, [conversationId])

  useEffect(() => {
    if (!godMode) {
      setHasConfirmedGod(false)
      setGodConfirmOpen(false)
      setGodGateMessage(null)
    }
  }, [godMode])

  const flushSend = useCallback(() => {
    const trimmed = value.trim()
    const completedAttachments = attachments.filter(a => a.status === 'done' && a.documentId)
    const attachmentIds = completedAttachments.map(a => a.documentId!)
    onSend(trimmed || '', attachmentIds.length > 0 ? attachmentIds : undefined, planMode ? { plan: true } : undefined)

    attachments.forEach(a => { if (a.preview) URL.revokeObjectURL(a.preview) })
    setAttachments([])
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [value, attachments, onSend, planMode])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    const completedAttachments = attachments.filter(a => a.status === 'done' && a.documentId)
    if (!trimmed && completedAttachments.length === 0) return
    if (disabled || isUploading) return

    if (godMode) {
      if (conversationStatus === 'working') {
        setGodGateMessage('busy')
        return
      }
      if (godEstimateError || (godEstimate && godEstimate.participants.length < 2)) {
        setGodGateMessage('config')
        return
      }
      if (!godEstimate) return
      const decision = shouldConfirmGodSend(hasConfirmedGod, godEstimate.usd, godEstimate.ceilingUsd)
      if (decision === 'block-ceiling') {
        setGodGateMessage('ceiling')
        return
      }
      if (decision === 'confirm') {
        setGodGateMessage(null)
        setGodConfirmOpen(true)
        return
      }
    }

    setGodGateMessage(null)
    flushSend()
  }, [
    value,
    disabled,
    isUploading,
    attachments,
    godMode,
    conversationStatus,
    godEstimate,
    godEstimateError,
    hasConfirmedGod,
    flushSend,
  ])

  const handleGodConfirm = useCallback(() => {
    setHasConfirmedGod(true)
    setGodConfirmOpen(false)
    setGodGateMessage(null)
    flushSend()
  }, [flushSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return
      e.target.value = ''
      addFiles(Array.from(files))
    },
    [addFiles]
  )

  const handlePaperclipClick = () => {
    if (!isUploading) fileInputRef.current?.click()
  }

  // Paste handler for images
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      addFiles(imageFiles)
    }
  }, [addFiles])

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) addFiles(files)
  }, [addFiles])

  return (
    <div
      ref={dropRef}
      className={`flex-shrink-0 border-t p-3 ${isDragging ? 'bg-primary/5 border-primary/30' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {godMode && (
        <GodModeBanner
          conversationId={conversationId}
          conversationStatus={conversationStatus}
          workingDirectories={workingDirectories}
          estimate={godEstimate}
          estimateError={Boolean(godEstimateError)}
          gateMessage={godGateMessage}
        />
      )}

      {/* Attachment preview strip */}
      {attachments.length > 0 && (
        <div className="flex gap-2 px-1 pb-2 overflow-x-auto">
          {attachments.map(att => (
            <div key={att.id} className="relative group flex-shrink-0">
              {att.mimeType.startsWith('image/') && att.preview ? (
                <img
                  src={att.preview}
                  className="h-16 w-16 object-cover rounded-lg border border-border/50"
                  alt={att.filename}
                />
              ) : (
                <div className="h-16 w-16 rounded-lg border border-border/50 bg-muted flex flex-col items-center justify-center gap-1">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span className="text-[9px] text-muted-foreground truncate max-w-[56px] px-0.5">
                    {att.filename.split('.').pop()?.toUpperCase() || 'DOC'}
                  </span>
                </div>
              )}
              {att.status === 'uploading' && (
                <div className="absolute inset-0 bg-black/30 rounded-lg flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                </div>
              )}
              {att.status === 'error' && (
                <div className="absolute inset-0 bg-destructive/30 rounded-lg flex items-center justify-center">
                  <span className="text-[10px] text-white font-medium">{t('conversations.input.error')}</span>
                </div>
              )}
              <button
                onClick={() => removeAttachment(att.id)}
                className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.txt,.csv,.json,.xml,.yaml,.yml"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Paperclip button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground flex-shrink-0"
          disabled={isUploading}
          title={t('conversations.input.attachFile')}
          onClick={handlePaperclipClick}
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
        </Button>

        {/* Prompt Enhancer button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-blue-400 flex-shrink-0"
          title={t('conversations.input.promptEnhancer')}
          onClick={() => setEnhancerOpen(true)}
        >
          <Wand2 className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={`h-9 w-9 flex-shrink-0 ${planMode ? 'text-primary' : 'text-muted-foreground'}`}
          title={t('conversations.input.planModeHint')}
          aria-pressed={planMode}
          onClick={() => setPlanMode((on) => !on)}
        >
          <Map className="h-4 w-4" />
        </Button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t('conversations.input.placeholder')}
          disabled={disabled}
          rows={3}
          className="flex-1 resize-y bg-accent/30 border border-border/50 rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[72px] max-h-[300px]"
        />

        <Button
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          disabled={disabled || isUploading || (!value.trim() && attachments.filter(a => a.status === 'done').length === 0)}
          onClick={handleSend}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>

      <GodModeConfirmDialog
        open={godConfirmOpen}
        estimate={godEstimate}
        onCancel={() => setGodConfirmOpen(false)}
        onConfirm={handleGodConfirm}
      />

      <PromptEnhancerDialog
        open={enhancerOpen}
        onClose={() => setEnhancerOpen(false)}
        parentConversationId={conversationId}
        draft={value}
        targetProviderId={providerId}
        targetModelId={modelId}
        onApply={(refined, carryAttachmentIds) => {
          setValue(refined)
          if (carryAttachmentIds && carryAttachmentIds.length > 0) {
            addLinkedDocuments(carryAttachmentIds)
          }
          requestAnimationFrame(() => {
            const el = textareaRef.current
            if (el) {
              el.focus()
              el.selectionStart = el.selectionEnd = refined.length
            }
          })
        }}
      />
    </div>
  )
}
