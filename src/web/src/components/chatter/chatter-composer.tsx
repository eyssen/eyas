import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Send } from 'lucide-react'
import { api } from '@/lib/api'
import { t } from '@/pages/conversations/i18n'

interface ChatterComposerProps {
  conversationId: string
  onSent: () => void
}

/**
 * Context-rail note composer. Conversation panel is note-only
 * (no "Send message" until an outbound follower channel exists).
 */
export function ChatterComposer({ conversationId, onSent }: ChatterComposerProps) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const handleSend = useCallback(async () => {
    const trimmed = body.trim()
    if (!trimmed || sending) return

    setSending(true)
    try {
      await api.post(`/chatter/conversation/${conversationId}/messages`, {
        body: trimmed,
        messageType: 'note',
      })
      setBody('')
      onSent()
    } catch (err) {
      console.error('Failed to send chatter note:', err)
    } finally {
      setSending(false)
    }
  }, [body, sending, conversationId, onSent])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-border/50 p-3 flex-shrink-0">
      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('conversations.chatter.notePlaceholder')}
          rows={2}
          className="flex-1 resize-none bg-accent/30 border border-border/50 rounded-lg px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[48px] max-h-[120px]"
        />
        <Button
          size="icon"
          className="h-8 w-8 flex-shrink-0"
          disabled={sending || !body.trim()}
          onClick={handleSend}
          title={t('conversations.chatter.addNote')}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
