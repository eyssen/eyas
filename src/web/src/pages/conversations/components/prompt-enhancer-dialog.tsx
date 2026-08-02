// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useDocumentsStore } from '@/stores/documents-store'
import { ArrowUp, Check, FileText, Loader2, Paperclip, Sparkles, X } from 'lucide-react'
import { t } from '../i18n'

interface PromptEnhancerDialogProps {
  open: boolean
  onClose: () => void
  parentConversationId: string
  /** Current draft from the parent input — seeds the first enhancer message. */
  draft: string
  /**
   * Called when the user clicks Apply. Receives the refined prompt text plus
   * an optional list of document IDs to carry over to the parent input, as
   * decided by the enhancer via `carry-attachments` attribute on <final-prompt>.
   */
  onApply: (refinedPrompt: string, carryAttachmentIds?: string[]) => void
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachmentIds?: string[]
}

interface ConversationPayload {
  id: string
  messages: ChatMessage[]
}

interface PendingAttachment {
  id: string
  file: File
  preview: string
  status: 'uploading' | 'done' | 'error'
  documentId?: string
}

interface FinalPromptResult {
  text: string
  carryAttachments: 'all' | 'none'
}

/**
 * Extracts a `<final-prompt>...</final-prompt>` block from an assistant message.
 * The opening tag may carry a `carry-attachments="all|none"` attribute that the
 * enhancer uses to signal whether uploaded files should flow to the parent input.
 */
function extractFinalPrompt(text: string): FinalPromptResult | null {
  const blockMatch = text.match(/<final-prompt(\s[^>]*)?>\s*([\s\S]*?)\s*<\/final-prompt>/i)
  if (!blockMatch) return null
  const attrs = blockMatch[1] ?? ''
  const attrMatch = attrs.match(/carry-attachments\s*=\s*["']?(all|none)["']?/i)
  const carry: 'all' | 'none' = attrMatch?.[1]?.toLowerCase() === 'all' ? 'all' : 'none'
  return { text: blockMatch[2].trim(), carryAttachments: carry }
}

export function PromptEnhancerDialog({
  open,
  onClose,
  parentConversationId,
  draft,
  onApply,
}: PromptEnhancerDialogProps) {
  const [enhancerId, setEnhancerId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { uploadFile } = useDocumentsStore()

  const isUploading = attachments.some(a => a.status === 'uploading')

  // Bootstrap the sub-conversation when the dialog opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    ;(async () => {
      try {
        setBusy(true)
        const res = await api.post<{ id: string; seededDraft: boolean }>(
          `/conversations/${parentConversationId}/prompt-enhancer`,
          { draft },
        )
        if (cancelled) return
        setEnhancerId(res.id)
        const conv = await api.get<ConversationPayload>(`/conversations/${res.id}`)
        if (cancelled) return
        setMessages(conv.messages ?? [])

        const hasAssistant = (conv.messages ?? []).some(m => m.role === 'assistant')
        const hasSeedUser = (conv.messages ?? []).some(m => m.role === 'user')
        if (res.seededDraft && !hasAssistant && hasSeedUser) {
          await triggerAssistantResponse(res.id)
          if (cancelled) return
          const updated = await api.get<ConversationPayload>(`/conversations/${res.id}`)
          if (!cancelled) setMessages(updated.messages ?? [])
        }
      } catch (err: any) {
        if (!cancelled) setError(String(err?.message ?? err))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, parentConversationId, draft])

  // Reset local attachment state when the dialog closes so a reopen starts clean.
  useEffect(() => {
    if (open) return
    attachments.forEach(a => { if (a.preview) URL.revokeObjectURL(a.preview) })
    setAttachments([])
    setInput('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  /**
   * POST to `/conversations/:id/messages` and drain the resulting SSE stream.
   * The endpoint streams token deltas; we only need to wait until it's done.
   * Token-by-token UI updates aren't needed in this dialog — we refetch the
   * full conversation once the stream completes.
   */
  async function postMessageStreamed(
    convId: string,
    body: { content: string; attachmentIds?: string[] },
  ): Promise<void> {
    const res = await fetch(`/api/v1/conversations/${convId}/messages`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Eyas-Request': '1' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(errData.error || res.statusText)
    }
    const reader = res.body?.getReader()
    if (!reader) return
    // Drain the stream — we don't need token-level updates here.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  }

  async function triggerAssistantResponse(convId: string) {
    try {
      await postMessageStreamed(convId, { content: t('conversations.promptEnhancer.seedMessage') })
    } catch {
      /* non-fatal */
    }
  }

  const addFiles = useCallback(async (files: File[]) => {
    if (!enhancerId) return
    const newAttachments: PendingAttachment[] = files.map(file => ({
      id: crypto.randomUUID(),
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      status: 'uploading' as const,
    }))
    setAttachments(prev => [...prev, ...newAttachments])

    for (const att of newAttachments) {
      const doc = await uploadFile(att.file, 'conversations', enhancerId, 'user')
      setAttachments(prev =>
        prev.map(a =>
          a.id === att.id
            ? doc
              ? { ...a, status: 'done' as const, documentId: doc.id }
              : { ...a, status: 'error' as const }
            : a,
        ),
      )
    }
  }, [uploadFile, enhancerId])

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => {
      const att = prev.find(a => a.id === id)
      if (att?.preview) URL.revokeObjectURL(att.preview)
      return prev.filter(a => a.id !== id)
    })
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return
      e.target.value = ''
      addFiles(Array.from(files))
    },
    [addFiles],
  )

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) imageFiles.push(f)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      addFiles(imageFiles)
    }
  }, [addFiles])

  const sendMessage = useCallback(async () => {
    if (!enhancerId || busy || isUploading) return
    const content = input.trim()
    const readyAttachmentIds = attachments
      .filter(a => a.status === 'done' && a.documentId)
      .map(a => a.documentId!)
    if (!content && readyAttachmentIds.length === 0) return

    setInput('')
    setMessages(prev => [
      ...prev,
      { id: `tmp-${Date.now()}`, role: 'user', content, attachmentIds: readyAttachmentIds },
    ])
    // Clear previews but retain document IDs in a separate pool so that the
    // final-prompt `carry-attachments="all"` hand-off still has access to them.
    attachments.forEach(a => { if (a.preview) URL.revokeObjectURL(a.preview) })
    setAttachments([])
    setBusy(true)
    try {
      await postMessageStreamed(enhancerId, {
        content,
        attachmentIds: readyAttachmentIds.length > 0 ? readyAttachmentIds : undefined,
      })
      const conv = await api.get<ConversationPayload>(`/conversations/${enhancerId}`)
      setMessages(conv.messages ?? [])
    } catch (err: any) {
      setError(String(err?.message ?? err))
    } finally {
      setBusy(false)
    }
  }, [enhancerId, input, busy, isUploading, attachments])

  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  const parsed = lastAssistant ? extractFinalPrompt(lastAssistant.content) : null
  const acceptedText = parsed?.text ?? lastAssistant?.content ?? ''

  // Collect every document ID the user uploaded during this enhancer session.
  const sessionAttachmentIds = Array.from(new Set(
    messages.flatMap(m => m.attachmentIds ?? []),
  ))

  const handleApply = () => {
    if (!acceptedText) return
    const carry = parsed?.carryAttachments === 'all' && sessionAttachmentIds.length > 0
      ? sessionAttachmentIds
      : undefined
    onApply(acceptedText, carry)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl w-full h-[80vh] flex flex-col p-0 overflow-hidden bg-background">
        <DialogHeader className="p-4 border-b border-border flex-shrink-0 bg-background">
          <DialogTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-400" />
            {t('conversations.promptEnhancer.title')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('conversations.promptEnhancer.description')}
          </DialogDescription>
        </DialogHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2">
              {error}
            </div>
          )}
          {messages.length === 0 && !busy && (
            <p className="text-xs text-muted-foreground italic">
              {t('conversations.promptEnhancer.emptyHint')}
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`p-3 rounded-lg text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-blue-500/10 border border-blue-500/20 ml-10'
                  : 'bg-accent/40 border border-border mr-10'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-2">
                <span>{m.role === 'user' ? t('conversations.promptEnhancer.you') : t('conversations.promptEnhancer.enhancer')}</span>
                {m.attachmentIds && m.attachmentIds.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-blue-400 normal-case tracking-normal">
                    <Paperclip className="h-3 w-3" /> {t('conversations.promptEnhancer.files', { count: m.attachmentIds.length })}
                  </span>
                )}
              </div>
              {m.content}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> {t('conversations.promptEnhancer.inProgress')}
            </div>
          )}
        </div>

        {parsed && (
          <div className="px-4 py-2 border-t border-border bg-green-500/5 flex-shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-green-400 font-medium mb-1 flex items-center gap-2">
              <span>{t('conversations.promptEnhancer.suggestedPrompt')}</span>
              {parsed.carryAttachments === 'all' && sessionAttachmentIds.length > 0 && (
                <span className="inline-flex items-center gap-1 text-blue-400">
                  <Paperclip className="h-3 w-3" /> {t('conversations.promptEnhancer.carryFiles', { count: sessionAttachmentIds.length })}
                </span>
              )}
            </div>
            <pre className="text-xs whitespace-pre-wrap max-h-24 overflow-y-auto">{parsed.text}</pre>
          </div>
        )}

        {/* Attachment preview strip (pending files for next message) */}
        {attachments.length > 0 && (
          <div className="px-3 pt-2 pb-1 border-t border-border flex gap-2 overflow-x-auto flex-shrink-0 bg-background">
            {attachments.map(att => (
              <div key={att.id} className="relative group flex-shrink-0">
                {att.file.type.startsWith('image/') && att.preview ? (
                  <img
                    src={att.preview}
                    alt={att.file.name}
                    className="h-14 w-14 object-cover rounded-md border border-border/50"
                  />
                ) : (
                  <div className="h-14 w-14 rounded-md border border-border/50 bg-muted flex flex-col items-center justify-center gap-0.5">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-[9px] text-muted-foreground truncate max-w-[52px] px-0.5">
                      {att.file.name.split('.').pop()?.toUpperCase()}
                    </span>
                  </div>
                )}
                {att.status === 'uploading' && (
                  <div className="absolute inset-0 bg-black/40 rounded-md flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  </div>
                )}
                {att.status === 'error' && (
                  <div className="absolute inset-0 bg-destructive/40 rounded-md flex items-center justify-center">
                    <span className="text-[9px] text-white font-medium">{t('conversations.promptEnhancer.err')}</span>
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="p-3 border-t border-border flex items-end gap-2 flex-shrink-0 bg-background">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.txt,.csv,.json,.xml,.yaml,.yml,.md"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground flex-shrink-0"
            disabled={!enhancerId || isUploading}
            title={t('conversations.promptEnhancer.attachFile')}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </Button>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            onPaste={handlePaste}
            disabled={busy || !enhancerId}
            placeholder={t('conversations.promptEnhancer.placeholder')}
            rows={2}
            className="flex-1 resize-none bg-accent/30 border border-border/50 rounded-lg px-3 py-2 text-sm min-h-[48px] max-h-[160px] focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            size="icon"
            className="h-9 w-9"
            onClick={sendMessage}
            disabled={busy || isUploading || (!input.trim() && attachments.filter(a => a.status === 'done').length === 0)}
            title={t('conversations.promptEnhancer.send')}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            onClick={handleApply}
            disabled={!acceptedText}
            className="h-9 text-xs"
            title={parsed ? t('conversations.promptEnhancer.applyTitleFinal') : t('conversations.promptEnhancer.applyTitleLast')}
          >
            <Check className="h-4 w-4 mr-1" /> {t('conversations.promptEnhancer.apply')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
