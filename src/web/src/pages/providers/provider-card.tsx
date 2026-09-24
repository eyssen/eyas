import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Bot, Terminal } from 'lucide-react'
import { t } from './i18n'
import { t as tSignIn } from '@/components/providers/i18n'
import type { ProviderKind } from '@/lib/provider-display'

/** One row of GET /model/providers: the name and kind come from the server's display source. */
export interface ProviderCardData {
  id: string
  name: string
  /** 'cli' gets the Terminal icon and the "CLI not found" badge. */
  kind?: ProviderKind
  enabled: boolean
  active: boolean
  hasApiKey: boolean | null
  modelCount: number
  enabledModelCount: number
  health?: { status: 'healthy' | 'auth_error'; message?: string; code?: 'cliSignIn' }
}

interface ProviderCardProps {
  provider: ProviderCardData
  onToggle: (id: string, enabled: boolean) => void
  onClick: (id: string) => void
}

// Description labels are i18n keys (resolved with t() at render time).
const PROVIDER_DESC_KEYS: Record<string, string> = {
  anthropic: 'providers.card.desc.anthropic',
  openai: 'providers.card.desc.openai',
  openrouter: 'providers.card.desc.openrouter',
  gemini: 'providers.card.desc.gemini',
  kimi: 'providers.card.desc.kimi',
  'claude-code': 'providers.card.desc.claudeCode',
  'claude-code-sdk': 'providers.card.desc.claudeCodeSdk',
  'grok-cli': 'providers.card.desc.grokCli',
  'kimi-cli': 'providers.card.desc.kimiCli',
  ollama: 'providers.card.desc.ollama',
  lmstudio: 'providers.card.desc.lmstudio',
  xai: 'providers.card.desc.xai',
  mistral: 'providers.card.desc.mistral',
  groq: 'providers.card.desc.groq',
  together: 'providers.card.desc.together',
  deepseek: 'providers.card.desc.deepseek',
  cerebras: 'providers.card.desc.cerebras',
  venice: 'providers.card.desc.venice',
  huggingface: 'providers.card.desc.huggingface',
  nvidia: 'providers.card.desc.nvidia',
  zai: 'providers.card.desc.zai',
  kilocode: 'providers.card.desc.kilocode',
  'vercel-ai-gateway': 'providers.card.desc.vercelAiGateway',
  qianfan: 'providers.card.desc.qianfan',
  vllm: 'providers.card.desc.vllm',
  minimax: 'providers.card.desc.minimax',
  synthetic: 'providers.card.desc.synthetic',
  xiaomi: 'providers.card.desc.xiaomi',
}

export function ProviderCard({ provider, onToggle, onClick }: ProviderCardProps) {
  const isCli = provider.kind === 'cli'
  const name = provider.name || provider.id

  return (
    <div
      className="glass-card p-4 flex items-start gap-4 text-left w-full hover:bg-accent/30 transition-colors cursor-pointer"
      onClick={() => onClick(provider.id)}
    >
      <div className="h-10 w-10 rounded-xl bg-accent/50 flex items-center justify-center flex-shrink-0">
        {isCli ? (
          <Terminal className="h-5 w-5 text-muted-foreground" />
        ) : (
          <Bot className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{name}</span>
          {provider.active ? (
            <Badge variant="secondary" className="text-emerald-500 text-[10px]">{t('common.active')}</Badge>
          ) : provider.enabled ? (
            <Badge variant="outline" className="text-amber-500 text-[10px]">
              {isCli ? t('providers.card.cliNotFound') : t('providers.card.noApiKey')}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground text-[10px]">{t('common.disabled')}</Badge>
          )}
          {provider.health?.status === 'auth_error' && (
            provider.health.code === 'cliSignIn' ? (
              // A Grok/Kimi CLI whose EYAS home is not signed in.
              <Badge
                variant="destructive"
                className="text-[10px]"
                title={tSignIn('providers.signIn.requiredHint', { provider: name })}
              >
                {tSignIn('providers.signIn.required')}
              </Badge>
            ) : (
              <Badge
                variant="destructive"
                className="text-[10px]"
                title={provider.health.message ?? t('providers.card.authErrorTooltip')}
              >
                {t('providers.card.authError')}
              </Badge>
            )
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {PROVIDER_DESC_KEYS[provider.id] ? t(PROVIDER_DESC_KEYS[provider.id]) : ''}
        </p>
        {provider.modelCount > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            {t('providers.card.modelsEnabled', { enabled: provider.enabledModelCount, total: provider.modelCount })}
          </p>
        )}
      </div>
      <div
        className="flex-shrink-0 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[10px] text-muted-foreground">{provider.enabled ? t('providers.card.on') : t('providers.card.off')}</span>
        <Switch
          checked={provider.enabled}
          onCheckedChange={(checked) => onToggle(provider.id, checked)}
        />
      </div>
    </div>
  )
}
