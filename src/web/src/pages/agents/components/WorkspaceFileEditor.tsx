// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { t } from '../i18n'

interface Props {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}

export function WorkspaceFileEditor({ value, onChange, disabled }: Props) {
  const [showPreview, setShowPreview] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={showPreview ? 'outline' : 'default'}
          size="sm"
          className="h-6 text-[11px] px-2"
          onClick={() => setShowPreview(false)}
        >
          {t('agents.fileEditor.editor')}
        </Button>
        <Button
          type="button"
          variant={showPreview ? 'default' : 'outline'}
          size="sm"
          className="h-6 text-[11px] px-2"
          onClick={() => setShowPreview(true)}
        >
          {t('agents.fileEditor.preview')}
        </Button>
      </div>

      {showPreview ? (
        <pre className="min-h-[320px] rounded-md border border-border/50 bg-accent/20 px-3 py-2 text-sm whitespace-pre-wrap overflow-y-auto">
          {value || t('agents.fileEditor.empty')}
        </pre>
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full min-h-[320px] rounded-md border border-border/50 bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-y"
          placeholder={t('agents.fileEditor.placeholder')}
          spellCheck={false}
        />
      )}
    </div>
  )
}
