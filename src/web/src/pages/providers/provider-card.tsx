import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Bot, Terminal } from 'lucide-react'
import { t } from './i18n'

export interface ProviderCardData {
  id: string
  name: string
  enabled: boolean
  active: boolean
  hasApiKey: boolean | null
  modelCount: number
  enabledModelCount: number
  health?: { status: 'healthy' | 'auth_error'; message?: string }
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

/** Product names as marketed — prefer over raw provider.id fallback. */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
  kimi: 'Kimi',
  'claude-code': 'Claude Code CLI',
  'claude-code-sdk': 'Claude Code SDK',
  'grok-cli': 'Grok CLI',
  'kimi-cli': 'Kimi Code CLI',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  xai: 'xAI',
  mistral: 'Mistral',
  groq: 'Groq',
  together: 'Together AI',
  deepseek: 'DeepSeek',
  cerebras: 'Cerebras',
  venice: 'Venice AI',
  huggingface: 'Hugging Face',
  nvidia: 'NVIDIA',
  zai: 'Z.AI',
  kilocode: 'Kilo Gateway',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  qianfan: 'Qianfan',
  vllm: 'vLLM',
  minimax: 'MiniMax',
  synthetic: 'Synthetic',
  xiaomi: 'Xiaomi MiMo',
}

/** Host CLI agents (local binary + ACP/SDK) — Terminal icon, not the cloud Bot icon. */
const CLI_PROVIDER_IDS = new Set(['claude-code', 'claude-code-sdk', 'grok-cli', 'kimi-cli'])

function isCliProvider(id: string): boolean {
  return CLI_PROVIDER_IDS.has(id) || id.endsWith('-cli')
}

export function ProviderCard({ provider, onToggle, onClick }: ProviderCardProps) {
  const isCli = isCliProvider(provider.id)

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
          <span className="font-medium text-sm">{PROVIDER_DISPLAY_NAMES[provider.id] ?? provider.name}</span>
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
            <Badge
              variant="destructive"
              className="text-[10px]"
              title={provider.health.message ?? t('providers.card.authErrorTooltip')}
            >
              {t('providers.card.authError')}
            </Badge>
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
