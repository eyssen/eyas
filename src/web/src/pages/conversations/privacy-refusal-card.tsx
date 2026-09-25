// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A message the privacy policy refused before it was stored: it carries
// values (an IBAN, a card number, …) that must not reach a remote model. The
// card names the types — never the values — and offers three answers: send it
// with those values masked, put it back into the composer to edit, or drop it.

import { ShieldAlert, Send, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t, tOr } from './i18n'
// Registers the privacy bundle: the localized PII type labels (privacy.type.*).
import '../privacy/i18n'
import type { PrivacyProposal } from './privacy-refusal'

/** A PII type's localized label; a custom pattern's type is shown with its slug. */
export function privacyTypeLabel(type: string): string {
  return tOr(`privacy.type.${type}`, t('privacy.type.custom', { type }))
}

interface Props {
  proposal: PrivacyProposal
  disabled?: boolean
  onSendMasked(): void
  onEdit(): void
  onDismiss(): void
}

export function PrivacyRefusalCard({ proposal, disabled = false, onSendMasked, onEdit, onDismiss }: Props) {
  const types = proposal.types.map(privacyTypeLabel).join(', ')
  return (
    <div className="glass-card p-3 space-y-2 border-l-2 border-l-destructive" role="alert">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
        <span className="text-sm font-medium">{t('conversations.privacy.refused.title')}</span>
      </div>

      <p className="text-xs text-muted-foreground">{t('conversations.privacy.refused.body', { types })}</p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" disabled={disabled} onClick={onSendMasked}>
          <Send className="h-3.5 w-3.5 mr-1" />
          {t('conversations.privacy.refused.sendMasked')}
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5 mr-1" />
          {t('conversations.privacy.refused.edit')}
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={onDismiss}>
          <X className="h-3.5 w-3.5 mr-1" />
          {t('conversations.privacy.refused.dismiss')}
        </Button>
      </div>
    </div>
  )
}
