// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { PromptChainView } from './prompt-chain-view'
import { Wand2, Loader2 } from 'lucide-react'
import { t } from '../i18n'

interface PromptTemplate {
  id: string
  level: string
  name: string
  content: string
  isActive: boolean
}

interface WizardDialogProps {
  open: boolean
  onClose: () => void
  conversationId: string
  projectId?: string | null
  conversationPrompt?: string | null
  onPromptApplied?: (prompt: string) => void
}

export function WizardDialog({
  open,
  onClose,
  conversationId,
  projectId,
  conversationPrompt,
  onPromptApplied,
}: WizardDialogProps) {
  const { data: templatesData } = useApi<{ templates: PromptTemplate[] }>('/prompts')
  const [wizardOutput, setWizardOutput] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const templates = templatesData?.templates ?? []
  const masterPrompt = templates.find((t) => t.level === 'master' && t.isActive)
  const projectTypePrompt = templates.find((t) => t.level === 'project_type' && t.isActive)
  const projectPrompt = templates.find((t) => t.level === 'project' && t.isActive)

  const levels = [
    {
      label: t('conversations.wizard.levelMaster'),
      name: masterPrompt?.name ?? null,
      preview: masterPrompt?.content?.slice(0, 120) ?? null,
      isActive: !!masterPrompt,
    },
    {
      label: t('conversations.wizard.levelProjectType'),
      name: projectTypePrompt?.name ?? null,
      preview: projectTypePrompt?.content?.slice(0, 120) ?? null,
      isActive: !!projectTypePrompt,
    },
    {
      label: t('conversations.wizard.levelProject'),
      name: projectPrompt?.name ?? null,
      preview: projectPrompt?.content?.slice(0, 120) ?? null,
      isActive: !!projectPrompt,
    },
    {
      label: t('conversations.wizard.levelConversation'),
      name: t('conversations.wizard.currentPrompt'),
      preview: conversationPrompt?.slice(0, 120) ?? null,
      isActive: !!conversationPrompt,
    },
  ]

  const handleStartWizard = useCallback(async () => {
    setIsRunning(true)
    try {
      // Create a wizard sub-conversation
      const result = await api.post<{ conversationId: string; prompt: string }>(
        `/conversations/${conversationId}/wizard`,
        { projectId }
      )
      setWizardOutput(result.prompt)
    } catch (err: any) {
      console.error('Wizard failed:', err)
    } finally {
      setIsRunning(false)
    }
  }, [conversationId, projectId])

  const handleApply = useCallback(async () => {
    if (!wizardOutput) return
    await api.patch(`/conversations/${conversationId}`, { systemPrompt: wizardOutput })
    onPromptApplied?.(wizardOutput)
    setWizardOutput(null)
    onClose()
  }, [conversationId, wizardOutput, onPromptApplied, onClose])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-amber-400" />
            {t('conversations.wizard.title')}
          </DialogTitle>
          <DialogDescription>
            {t('conversations.wizard.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="py-3">
          <PromptChainView levels={levels} />
        </div>

        {wizardOutput && (
          <div className="space-y-2">
            <span className="text-xs font-medium">{t('conversations.wizard.generatedPrompt')}</span>
            <div className="rounded-md border border-border/50 bg-background p-3 text-xs max-h-40 overflow-y-auto whitespace-pre-wrap">
              {wizardOutput}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {wizardOutput ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setWizardOutput(null)}>
                {t('conversations.wizard.discard')}
              </Button>
              <Button size="sm" onClick={handleApply}>
                {t('conversations.wizard.applyPrompt')}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={handleStartWizard} disabled={isRunning}>
              {isRunning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  {t('conversations.wizard.running')}
                </>
              ) : (
                <>
                  <Wand2 className="h-3.5 w-3.5 mr-1" />
                  {t('conversations.wizard.startWizard')}
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
