import { useApi } from '@/hooks/use-api'
import { useThemeStore } from '@/stores/theme-store'
import { useLanguageStore, SUPPORTED_LANGS, LANG_LABELS } from '@/stores/language-store'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Moon, Sun, Bot, LayoutDashboard, KeyRound, Users } from 'lucide-react'
import { TEMPLATES } from '@/themes/registry'
import ModelAssignmentsCard from './model-assignments-card'
import TeamAgentsCard from './team-agents-card'
import AutonomyFeaturesCard from './autonomy-features-card'
import DataPortCard from './data-port-card'
import SystemUpdateCard from './system-update-card'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
  kimi: 'Kimi',
  'claude-code': 'Claude Code CLI',
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

interface ProviderItem {
  id: string
  name: string
  enabled: boolean
  active: boolean
  modelCount: number
  enabledModelCount: number
}

interface HealthResponse { status: string; version: string; timestamp: string }

export default function SettingsPage() {
  const { data: health } = useApi<HealthResponse>('/health')
  const { data: providerData } = useApi<{ providers: ProviderItem[] }>('/model/providers')
  const { data: secretData } = useApi<{ secrets: unknown[] }>('/secrets?scope=system')
  const { data: userData } = useApi<{ users: unknown[] }>('/users')
  const { theme, set: setTheme, template, setTemplate } = useThemeStore()
  const { lang, setLang } = useLanguageStore()

  const providers = providerData?.providers ?? []
  const activeProviders = providers.filter(p => p.active)
  const totalModels = providers.reduce((sum, p) => sum + p.modelCount, 0)
  const enabledModels = providers.reduce((sum, p) => sum + p.enabledModelCount, 0)
  const secretCount = secretData?.secrets?.length || 0
  const userCount = userData?.users?.length || 0

  const stats = [
    {
      label: t('settings.page.stats.providers'),
      value: `${activeProviders.length}/${providers.length}`,
      sub: activeProviders.length > 0 ? t('settings.page.stats.active') : t('settings.page.stats.noneActive'),
      subColor: activeProviders.length > 0 ? 'text-emerald-500' : 'text-muted-foreground',
      icon: Bot,
    },
    {
      label: t('settings.page.stats.models'),
      value: `${enabledModels}/${totalModels}`,
      sub: t('settings.page.stats.enabled'),
      subColor: enabledModels > 0 ? 'text-emerald-500' : 'text-muted-foreground',
      icon: LayoutDashboard,
    },
    { label: t('settings.page.stats.secrets'), value: secretCount, sub: t('settings.page.stats.encrypted'), subColor: 'text-purple-400', icon: KeyRound },
    { label: t('settings.page.stats.users'), value: userCount, sub: t('settings.page.stats.registered'), subColor: 'text-muted-foreground', icon: Users },
  ]

  return (
    <div>
      <h1 className="page-title inline-flex items-center gap-1.5">{t('settings.page.title')} <ContextualHelp helpId="admin.settings" /></h1>
      <p className="text-sm text-muted-foreground mb-5">{t('settings.page.subtitle')}</p>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {stats.map((stat) => (
          <div key={stat.label} className="glass-card p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            <div className="section-label">{stat.label}</div>
            <div className="text-[28px] font-bold tracking-tight mt-1">{stat.value}</div>
            <div className={`text-[10px] mt-1 font-medium ${stat.subColor}`}>{stat.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {/* All Providers */}
        <div className="col-span-3 lg:col-span-2 glass-card p-4">
          <h3 className="text-sm font-semibold mb-3">{t('settings.page.providers.heading')}</h3>
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('settings.page.providers.empty')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {providers.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg bg-accent/30">
                  <div className={`w-2 h-2 rounded-full ${p.active ? 'bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-zinc-600'}`} />
                  <span className="text-sm flex-1">{PROVIDER_DISPLAY_NAMES[p.id] ?? p.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('settings.page.providers.modelCount', { enabled: p.enabledModelCount, total: p.modelCount })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column: system info + appearance */}
        <div className="col-span-3 lg:col-span-1 flex flex-col gap-4">
          {/* System info */}
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold mb-3">{t('settings.page.sysinfo.heading')}</h3>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('settings.page.sysinfo.version')}</span><span>{health?.version || '—'}</span></div>
              <Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">{t('settings.page.sysinfo.status')}</span><span className="text-emerald-500">● {health?.status || t('settings.page.sysinfo.unknown')}</span></div>
              <Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">{t('settings.page.sysinfo.runtime')}</span><span>Bun</span></div>
              <Separator />
              <div className="flex justify-between"><span className="text-muted-foreground">{t('settings.page.sysinfo.database')}</span><span>SQLite (WAL)</span></div>
            </div>
          </div>

          <SystemUpdateCard />

          <DataPortCard />

          {/* Appearance */}
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold mb-3">{t('settings.page.appearance.heading')}</h3>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm">{t('settings.page.appearance.theme')}</p>
                <p className="text-xs text-muted-foreground">{t('settings.page.appearance.themeDesc')}</p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant={theme === 'dark' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setTheme('dark')}
                >
                  <Moon className="h-3.5 w-3.5 mr-1" /> {t('settings.page.appearance.dark')}
                </Button>
                <Button
                  variant={theme === 'light' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setTheme('light')}
                >
                  <Sun className="h-3.5 w-3.5 mr-1" /> {t('settings.page.appearance.light')}
                </Button>
              </div>
            </div>

            <Separator className="my-3" />

            <div>
              <p className="text-sm">{t('settings.page.appearance.language')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.page.appearance.languageDesc')}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {SUPPORTED_LANGS.map((l) => (
                  <Button
                    key={l}
                    variant={lang === l ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-pressed={lang === l}
                    onClick={() => setLang(l)}
                  >
                    {LANG_LABELS[l]}
                  </Button>
                ))}
              </div>
            </div>

            <Separator className="my-3" />

            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm">{t('settings.page.appearance.template')}</p>
                <p className="text-xs text-muted-foreground">{t('settings.page.appearance.templateDesc')}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {TEMPLATES.map((t) => (
                <Button
                  key={t.id}
                  type="button"
                  variant={template === t.id ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={template === t.id}
                  title={t.description}
                  onClick={() => setTemplate(t.id)}
                  className="gap-1.5"
                >
                  <span className="flex -space-x-1" aria-hidden="true">
                    {t.swatch.map((c, i) => (
                      <span key={i} className="h-2.5 w-2.5 rounded-full border border-border" style={{ background: c }} />
                    ))}
                  </span>
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Post-setup config (authenticated replacements for the wizard's optional steps) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <ModelAssignmentsCard />
        <TeamAgentsCard />
      </div>

      <AutonomyFeaturesCard />
    </div>
  )
}
