// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Save, Loader2 } from 'lucide-react'
import { loadWorkspaceFile, saveWorkspaceFile } from '@/api/workspace'
import { IdentityEditor } from './IdentityEditor'
import { WorkspaceFileEditor } from './WorkspaceFileEditor'
import { WorkspaceHistoryPanel } from './WorkspaceHistoryPanel'
import { t } from '../i18n'

type WorkspaceFileKey = 'IDENTITY.md' | 'AGENTS.md' | 'TOOLS.md' | 'MEMORY.md'

// Labels are i18n keys resolved with t() at render time; the filename prefix is
// fixed and not translated.
const FILE_OPTIONS: { value: WorkspaceFileKey; labelKey: string }[] = [
  { value: 'IDENTITY.md', labelKey: 'agents.workspaceTab.file.identity' },
  { value: 'AGENTS.md', labelKey: 'agents.workspaceTab.file.agents' },
  { value: 'TOOLS.md', labelKey: 'agents.workspaceTab.file.tools' },
  { value: 'MEMORY.md', labelKey: 'agents.workspaceTab.file.memory' },
]

interface Props {
  agentId: string
}

export function AgentWorkspaceTab({ agentId }: Props) {
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileKey>('IDENTITY.md')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyKey, setHistoryKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await loadWorkspaceFile(agentId, selectedFile)
      setBody(result.body ?? '')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('agents.workspaceTab.loadError'))
      setBody('')
    } finally {
      setLoading(false)
    }
  }, [agentId, selectedFile])

  useEffect(() => { load() }, [load])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await saveWorkspaceFile(agentId, selectedFile, body)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('agents.workspaceTab.saveError'))
    } finally {
      setSaving(false)
    }
  }, [agentId, selectedFile, body])

  const handleRestored = useCallback(() => {
    load()
    setHistoryKey((k) => k + 1)
  }, [load])

  return (
    <div className="space-y-4">
      {/* File picker */}
      <div className="space-y-1.5">
        <Label className="text-xs">{t('agents.workspaceTab.fileLabel')}</Label>
        <select
          value={selectedFile}
          onChange={(e) => setSelectedFile(e.target.value as WorkspaceFileKey)}
          className="h-8 rounded-md border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {FILE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.value} — {t(opt.labelKey)}</option>
          ))}
        </select>
      </div>

      {/* Editor */}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          {t('agents.workspaceTab.loading')}
        </div>
      ) : selectedFile === 'IDENTITY.md' ? (
        <IdentityEditor value={body} onChange={setBody} />
      ) : (
        <WorkspaceFileEditor value={body} onChange={setBody} />
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Save */}
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving || loading}>
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5 mr-1" />
          )}
          {saved ? t('agents.workspaceTab.saved') : saving ? t('agents.workspaceTab.saving') : t('agents.workspaceTab.save')}
        </Button>
      </div>

      {/* History — collapsible */}
      <WorkspaceHistoryPanel
        key={historyKey}
        agentId={agentId}
        file={selectedFile}
        currentBody={body}
        onRestored={handleRestored}
      />
    </div>
  )
}
