// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Save, Lock, ChevronRight } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { ContextualHelp } from '@/components/docs/contextual-help'
import { t } from './i18n'

interface PromptSection {
  id: string
  section: string
  name: string
  content: string
  locked: boolean
}

export default function PromptSettings() {
  const { data, refetch } = useApi<{ sections: PromptSection[] }>('/prompts/master')
  const sections = data?.sections ?? []

  const [personalityContent, setPersonalityContent] = useState('')
  const [saving, setSaving] = useState(false)

  const personality = sections.find(s => s.section === 'personality')

  useEffect(() => {
    if (personality) setPersonalityContent(personality.content)
  }, [personality])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await api.patch('/prompts/master/personality', { content: personalityContent })
      refetch()
    } finally {
      setSaving(false)
    }
  }, [personalityContent, refetch])

  return (
    <div className="max-w-3xl">
      <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-4">
        <Link to="/prompts" className="hover:text-foreground transition-colors">{t('settings.prompt.crumbPrompts')}</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">{t('settings.prompt.title')}</span>
      </nav>
      <h2 className="text-lg font-semibold mb-4 inline-flex items-center gap-1.5">{t('settings.prompt.title')} <ContextualHelp helpId="ai.prompts" /></h2>
      <p className="text-sm text-muted-foreground mb-6">
        {t('settings.prompt.subtitle')}
      </p>

      <div className="space-y-4">
        {sections.filter(s => s.section !== 'personality').map(s => (
          <div key={s.id} className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Label className="text-xs font-medium">{s.name}</Label>
              {s.locked && (
                <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">
                  <Lock className="h-2.5 w-2.5 mr-1" />
                  {t('settings.prompt.locked')}
                </Badge>
              )}
            </div>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-accent/20 rounded-md p-3 max-h-48 overflow-y-auto">
              {s.content}
            </pre>
          </div>
        ))}

        {personality && (
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-medium">{personality.name}</Label>
                <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">
                  {t('settings.prompt.editable')}
                </Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={handleSave} disabled={saving}>
                <Save className="h-3.5 w-3.5 mr-1" />
                {saving ? t('settings.prompt.saving') : t('common.save')}
              </Button>
            </div>
            <textarea
              value={personalityContent}
              onChange={(e) => setPersonalityContent(e.target.value)}
              className="w-full min-h-[150px] rounded-md border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y font-mono"
            />
          </div>
        )}
      </div>
    </div>
  )
}
