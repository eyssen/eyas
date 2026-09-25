import { useState, useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'
import { api } from '@/lib/api'
import { ApiKeySection } from './provider-api-key-section'
import { ModelsSection, type ModelConfigItem } from './provider-models-section'
import { CliSignInCard } from '@/components/providers/cli-sign-in-card'
import { FileSandboxRow, type FileSandboxInfo } from './provider-file-sandbox'
import { LmStudioReasoningHint, type RuntimeReasoningInfo } from './lmstudio-reasoning-hint'
import { KimiModelPinHint } from './kimi-model-pin-hint'
import { CliRuntimeIsolation } from './provider-cli-runtime'
import { isIsolationProvider } from './provider-isolation-labels'
import type { ProviderKind } from '@/lib/provider-display'
import { t } from './i18n'

interface ProviderDetail {
  id: string
  /** The product name and kind (GET /model/providers/:id, from the server's display source). */
  name: string
  kind?: ProviderKind
  enabled: boolean
  active: boolean
  hasApiKey: boolean | null
  settings?: Record<string, unknown>
  /** CLI providers: the kernel file sandbox for the CLI's own tools. */
  fileSandbox?: FileSandboxInfo
  models: Array<{
    id: string
    modelId: string
    name: string
    enabled: boolean
    contextWindow: number | null
    maxOutputTokens: number | null
    supportsTools: boolean
    supportsImages: boolean
    supportsStreaming: boolean
    /** LM Studio: the reasoning setting it keeps for itself (display only). */
    runtimeReasoning?: RuntimeReasoningInfo
    /** The last successful discovery no longer offered this model. */
    missing?: boolean
    /** The effective reasoning capability (the models section shows its levels, default and source). */
    reasoning?: ModelConfigItem['reasoning']
  }>
}

interface ProviderPanelProps {
  providerId: string | null
  onClose: () => void
  onRefresh: () => void
}

export function ProviderPanel({ providerId, onClose, onRefresh }: ProviderPanelProps) {
  const { data, refetch } = useApi<ProviderDetail>(
    providerId ? `/model/providers/${providerId}` : ''
  )
  // Bumped when a sign-in or the provider switch changed what the CLI
  // runtime / isolation view reports, so it reloads.
  const [runtimeEpoch, setRuntimeEpoch] = useState(0)

  useEffect(() => {
    if (!providerId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [providerId, onClose])

  const handleToggleEnabled = useCallback(async (enabled: boolean) => {
    if (!providerId) return
    await api.patch(`/model/providers/${providerId}`, { enabled })
    refetch()
    onRefresh()
    setRuntimeEpoch((n) => n + 1)
  }, [providerId, refetch, onRefresh])

  const handleKeyOrModelsChanged = useCallback(() => {
    refetch()
    onRefresh()
  }, [refetch, onRefresh])

  const handleSignInChanged = useCallback(() => {
    handleKeyOrModelsChanged()
    setRuntimeEpoch((n) => n + 1)
  }, [handleKeyOrModelsChanged])

  if (!providerId) return null

  const detail = data
  // The kind decides the CLI layout; the CLI-specific copy below stays keyed by id.
  const isCli = detail?.kind === 'cli'
  const isClaudeCode = providerId === 'claude-code'
  const isGrokCli = providerId === 'grok-cli'
  const isKimiCli = providerId === 'kimi-cli'
  const panelTitle = detail?.name || providerId

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-[560px] max-h-[85vh] bg-background border rounded-xl shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{panelTitle}</h2>
            {detail?.active ? (
              <Badge variant="secondary" className="text-emerald-500 text-[10px]">{t('providers.panel.active')}</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground text-[10px]">{t('common.inactive')}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={detail?.enabled ?? false}
              onCheckedChange={handleToggleEnabled}
            />
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {!isCli && detail && (
            <ApiKeySection
              providerId={providerId}
              hasApiKey={detail.hasApiKey}
              onKeyChanged={handleKeyOrModelsChanged}
            />
          )}

          {isCli && (
            <div className="space-y-4">
              <div className="space-y-1">
                <span className="text-sm font-medium">{t('providers.panel.authentication')}</span>
                {isClaudeCode && (
                  <p className="text-xs text-muted-foreground">
                    {t('providers.panel.cliAuthDescPre')}{' '}
                    <code className="text-[10px]">claude</code> {t('providers.panel.cliAuthDescPost')}
                  </p>
                )}
              </div>

              {/* Grok / Kimi run in an EYAS-owned home: the host login is not
                  used, EYAS signs in for itself. */}
              {(isGrokCli || isKimiCli) && (
                <CliSignInCard providerId={isGrokCli ? 'grok-cli' : 'kimi-cli'} onChange={handleSignInChanged} />
              )}

              {isClaudeCode && (
                <p className="text-xs text-muted-foreground">
                  {t('providers.panel.claudeIsolationHint')}
                </p>
              )}

              {/* One Runtime line and the isolation status, from the same
                  resolver and store every turn uses. */}
              {isIsolationProvider(providerId) && (
                <CliRuntimeIsolation providerId={providerId} refreshKey={runtimeEpoch} />
              )}

              {/* Kimi's model and thinking are selected in-session from the
                  model list EYAS read; until then Kimi runs its own. */}
              {isKimiCli && detail && <KimiModelPinHint models={detail.models} />}

              {detail?.fileSandbox && <FileSandboxRow sandbox={detail.fileSandbox} canLeave={isClaudeCode} />}
            </div>
          )}

          {providerId === 'lmstudio' && detail && <LmStudioReasoningHint models={detail.models} />}

          <div className="border-t" />

          {detail && (
            <ModelsSection
              providerId={providerId}
              models={detail.models}
              onModelsChanged={handleKeyOrModelsChanged}
            />
          )}
        </div>
      </div>
    </div>
  )
}
