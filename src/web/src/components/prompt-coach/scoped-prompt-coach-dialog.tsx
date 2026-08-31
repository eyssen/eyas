// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import {
  extractFinalPrompts,
  extractQualityCheck,
  type ParsedFinalPrompt,
  type QualityCheck,
} from '@shared/conversations/prompt-profiles/final-prompt-parse'
import { ArrowUp, Check, GitBranch, Loader2, Sparkles } from 'lucide-react'
import { t } from './i18n'

export type PromptCoachScope = 'project' | 'project-type' | 'agent-system'

const ALTERNATIVES_USER_MESSAGE =
  'Please propose two alternative briefs for the same goal: one concise and one thorough. Emit one quality-check and two <final-prompt variant="concise|thorough"> blocks.'

interface ScopedPromptCoachDialogProps {
  open: boolean
  onClose: () => void
  scope: PromptCoachScope
  /** Current field value — seeds the coach. */
  draft: string
  /** Structured context for the coach system prompt. */
  context?: Record<string, unknown>
  onApply: (refined: string) => void
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface ConversationPayload {
  id: string
  messages: ChatMessage[]
}

function variantLabel(variant: string | null, index: number): string {
  if (!variant) return t('promptCoach.variantFallback', { n: index + 1 })
  const key = `promptCoach.variant.${variant}`
  const translated = t(key)
  return translated === key ? variant : translated
}

export function ScopedPromptCoachDialog({
  open,
  onClose,
  scope,
  draft,
  context,
  onApply,
}: ScopedPromptCoachDialogProps) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const draftOnOpenRef = useRef(draft)
  const contextOnOpenRef = useRef(context)
  useEffect(() => {
    if (open) {
      draftOnOpenRef.current = draft
      contextOnOpenRef.current = context
    }
  }, [open, draft, context])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    ;(async () => {
      try {
        setBusy(true)
        const res = await api.post<{
          id: string
          seededDraft: boolean
          scope: PromptCoachScope
        }>('/prompt-coach', {
          scope,
          draft: draftOnOpenRef.current,
          context: contextOnOpenRef.current ?? {},
        })
        if (cancelled) return
        setSessionId(res.id)
        const conv = await api.get<ConversationPayload>(`/conversations/${res.id}`)
        if (cancelled) return
        setMessages(conv.messages ?? [])
        setSelectedVariantIndex(0)

        const hasAssistant = (conv.messages ?? []).some((m) => m.role === 'assistant')
        const hasSeedUser = (conv.messages ?? []).some((m) => m.role === 'user')
        if (res.seededDraft && !hasAssistant && hasSeedUser) {
          await postMessageStreamed(res.id, { content: t('promptCoach.seedMessage') })
          if (cancelled) return
          const updated = await api.get<ConversationPayload>(`/conversations/${res.id}`)
          if (!cancelled) {
            setMessages(updated.messages ?? [])
            setSelectedVariantIndex(0)
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(String(err?.message ?? err))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft/context snapshotted on open
  }, [open, scope])

  useEffect(() => {
    if (open) return
    setInput('')
    setSessionId(null)
    setMessages([])
    setSelectedVariantIndex(0)
    setError(null)
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  async function postMessageStreamed(
    convId: string,
    body: { content: string },
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
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  }

  const sendContent = useCallback(
    async (content: string) => {
      if (!sessionId || busy) return
      setBusy(true)
      setError(null)
      try {
        await postMessageStreamed(sessionId, { content })
        const conv = await api.get<ConversationPayload>(`/conversations/${sessionId}`)
        setMessages(conv.messages ?? [])
        setSelectedVariantIndex(0)
      } catch (err: any) {
        setError(String(err?.message ?? err))
      } finally {
        setBusy(false)
      }
    },
    [sessionId, busy],
  )

  const sendMessage = useCallback(async () => {
    if (!sessionId || busy) return
    const content = input.trim()
    if (!content) return
    setInput('')
    setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, role: 'user', content }])
    await sendContent(content)
  }, [sessionId, input, busy, sendContent])

  const requestAlternatives = useCallback(async () => {
    if (!sessionId || busy) return
    setMessages((prev) => [
      ...prev,
      {
        id: `tmp-alt-${Date.now()}`,
        role: 'user',
        content: t('promptCoach.alternativesMessage'),
      },
    ])
    await sendContent(ALTERNATIVES_USER_MESSAGE)
  }, [sessionId, busy, sendContent])

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const lastAssistantContent = lastAssistant?.content ?? ''
  const variants: ParsedFinalPrompt[] = useMemo(
    () => (lastAssistantContent ? extractFinalPrompts(lastAssistantContent) : []),
    [lastAssistantContent],
  )
  const quality: QualityCheck | null = useMemo(
    () => (lastAssistantContent ? extractQualityCheck(lastAssistantContent) : null),
    [lastAssistantContent],
  )

  const selectedVariant: ParsedFinalPrompt | null =
    variants[selectedVariantIndex] ?? variants[0] ?? null
  const acceptedText =
    selectedVariant?.text
    ?? (lastAssistantContent && variants.length === 0 ? lastAssistantContent : '')
    ?? ''

  const handleApply = () => {
    if (!acceptedText) return
    onApply(acceptedText)
    onClose()
  }

  const scoreColor =
    quality == null
      ? ''
      : quality.score >= 8
        ? 'text-green-400 bg-green-500/10 border-green-500/20'
        : quality.score >= 6
          ? 'text-amber-300 bg-amber-500/10 border-amber-500/20'
          : 'text-red-300 bg-red-500/10 border-red-500/20'

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl w-full h-[80vh] flex flex-col p-0 overflow-hidden bg-background">
        <DialogHeader className="p-4 border-b border-border flex-shrink-0 bg-background">
          <DialogTitle className="text-sm flex items-center gap-2 flex-wrap">
            <Sparkles className="h-4 w-4 text-blue-400" />
            {t(`promptCoach.title.${scope}`)}
            <span className="text-[10px] font-normal normal-case tracking-normal px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20">
              {t(`promptCoach.scopeBadge.${scope}`)}
            </span>
            {quality && (
              <span
                className={`text-[10px] font-normal normal-case tracking-normal px-2 py-0.5 rounded-full border ${scoreColor}`}
                title={
                  quality.missing.length > 0
                    ? t('promptCoach.qualityMissing', { missing: quality.missing.join(', ') })
                    : t('promptCoach.qualityOk')
                }
              >
                {t('promptCoach.qualityScore', { score: quality.score })}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t(`promptCoach.description.${scope}`)}
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
              {t('promptCoach.emptyHint')}
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
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                {m.role === 'user' ? t('promptCoach.you') : t('promptCoach.coach')}
              </div>
              {m.content}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> {t('promptCoach.inProgress')}
            </div>
          )}
        </div>

        {variants.length > 0 && (
          <div className="px-4 py-2 border-t border-border bg-green-500/5 flex-shrink-0 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-green-400 font-medium">
              {t('promptCoach.suggestedPrompt')}
            </div>
            {variants.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {variants.map((v, i) => (
                  <button
                    key={`${v.variant ?? 'v'}-${i}`}
                    type="button"
                    onClick={() => setSelectedVariantIndex(i)}
                    className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                      selectedVariantIndex === i
                        ? 'bg-green-500/20 border-green-500/40 text-green-200'
                        : 'bg-accent/30 border-border/50 text-muted-foreground hover:bg-accent/50'
                    }`}
                  >
                    {variantLabel(v.variant, i)}
                  </button>
                ))}
              </div>
            )}
            <pre className="text-xs whitespace-pre-wrap max-h-28 overflow-y-auto">
              {selectedVariant?.text}
            </pre>
          </div>
        )}

        <div className="p-3 border-t border-border flex items-end gap-2 flex-shrink-0 bg-background">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground flex-shrink-0"
            disabled={!sessionId || busy}
            title={t('promptCoach.alternatives')}
            onClick={requestAlternatives}
          >
            <GitBranch className="h-4 w-4" />
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
            disabled={busy || !sessionId}
            placeholder={t('promptCoach.placeholder')}
            rows={2}
            className="flex-1 resize-none bg-accent/30 border border-border/50 rounded-lg px-3 py-2 text-sm min-h-[48px] max-h-[160px] focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            size="icon"
            className="h-9 w-9"
            onClick={sendMessage}
            disabled={busy || !input.trim()}
            title={t('promptCoach.send')}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            onClick={handleApply}
            disabled={!acceptedText}
            className="h-9 text-xs"
            title={
              variants.length > 0
                ? t('promptCoach.applyTitleFinal')
                : t('promptCoach.applyTitleLast')
            }
          >
            <Check className="h-4 w-4 mr-1" /> {t('promptCoach.apply')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
