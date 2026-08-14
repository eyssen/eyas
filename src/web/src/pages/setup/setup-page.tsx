import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { SetupStep } from './setup-step'
import { t } from './i18n'
import { TeamAgentsStep } from './team-agents-step'
import { AiProviderStep } from './ai-provider-step'
import { AiModelsStep } from './ai-models-step'
import { Card, CardContent } from '@/components/ui/card'
import { useThemeStore } from '@/stores/theme-store'
import { useLanguageStore, SUPPORTED_LANGS, LANG_SHORT } from '@/stores/language-store'
import { TEMPLATES } from '@/themes/registry'
import { Button } from '@/components/ui/button'
import { Moon, Sun } from 'lucide-react'
import logoDark from '@/assets/eyssen-logo-dark.png'
import logoLight from '@/assets/eyssen-logo-light.png'

interface Step {
  id: string
  title: string
  description: string
  required: boolean
  order: number
  status: string
  fields: { name: string; type: string; label: string; required: boolean; placeholder?: string }[]
}

export default function SetupPage() {
  const navigate = useNavigate()
  const { theme, set: setTheme, template, setTemplate } = useThemeStore()
  const { lang, setLang } = useLanguageStore()
  const { isAuthenticated, isLoading: authLoading } = useAuthStore()
  const [steps, setSteps] = useState<Step[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  // Owner credentials captured during the root-owner step, kept in memory only,
  // so the wizard can log in before the optional steps (which require an
  // authenticated owner once the required setup is complete).
  const ownerCreds = useRef<{ username: string; password: string } | null>(null)

  useEffect(() => {
    api.get<{ steps: Step[] }>('/setup/steps').then((d) => {
      const pending = d.steps.filter((s) => s.status === 'pending')
      setSteps(pending)
      setLoading(false)
    })
  }, [])

  // Reload fallback: if only optional steps remain (required setup already done)
  // and we're not authenticated with no in-memory credentials, the optional
  // writes would 404. Send the user to log in, then back to the wizard.
  useEffect(() => {
    if (loading || authLoading) return
    const onlyOptional = steps.length > 0 && steps.every((s) => !s.required)
    if (onlyOptional && !isAuthenticated && !ownerCreds.current) {
      navigate({ to: '/login', search: { redirect: '/setup' } })
    }
  }, [loading, authLoading, isAuthenticated, steps, navigate])

  // Hard navigation so the root layout re-fetches setup status (now complete);
  // its first-load value is stale (false) for the whole wizard session.
  const finish = () => { window.location.href = '/' }

  // Optional steps run after the required setup is complete; the setup write
  // endpoints then require an authenticated owner. Log in with the in-session
  // owner credentials, or bounce to /login (e.g. after a reload where they are
  // no longer in memory). Returns false if it redirected (caller should stop).
  const ensureAuthedForOptional = async (step: Step): Promise<boolean> => {
    if (step.required || useAuthStore.getState().isAuthenticated) return true
    if (ownerCreds.current) {
      await useAuthStore.getState().login(ownerCreds.current.username, ownerCreds.current.password)
      return true
    }
    navigate({ to: '/login', search: { redirect: '/setup' } })
    return false
  }

  // Some optional steps fetch authenticated data themselves as soon as they
  // mount (e.g. team-agents' template catalog), so logging in only at submit
  // time (above) is too late — the child's own effect would already have
  // fired unauthenticated and gotten redirected to /login. Gate the step's
  // render on the owner session being ready instead.
  const [stepAuthReady, setStepAuthReady] = useState(true)
  useEffect(() => {
    const step = steps[currentIndex]
    if (!step || step.required || useAuthStore.getState().isAuthenticated) {
      setStepAuthReady(true)
      return
    }
    setStepAuthReady(false)
    let cancelled = false
    ensureAuthedForOptional(step).then((ok) => { if (!cancelled) setStepAuthReady(ok) })
    return () => { cancelled = true }
  }, [currentIndex, steps])

  const handleStepSubmit = async (data: Record<string, string>) => {
    const step = steps[currentIndex]
    if (step.id === 'root-owner' && data.username && data.password) {
      ownerCreds.current = { username: data.username, password: data.password }
    }
    if (!(await ensureAuthedForOptional(step))) return
    await api.post(`/setup/steps/${step.id}`, data)

    const next = steps[currentIndex + 1]
    if (next) {
      // Completing the last required step flips the server to "setup complete",
      // after which the optional steps' endpoints (and their on-mount fetches)
      // require an authenticated owner. Establish the owner session HERE, before
      // the optional step mounts — otherwise its child effect fires an
      // unauthenticated request that 401s and bounces the whole wizard to
      // /login (dropping the user on the home page, never seeing team-agents /
      // ai-provider / ai-models). Best-effort: the per-step auth gate still
      // retries on render if this fails.
      if (!next.required && !useAuthStore.getState().isAuthenticated && ownerCreds.current) {
        try {
          await useAuthStore.getState().login(ownerCreds.current.username, ownerCreds.current.password)
        } catch { /* per-step gate will retry */ }
      }
      setCurrentIndex((i) => i + 1)
    } else {
      finish()
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground text-sm">{t('setup.loading')}</div>
      </div>
    )
  }

  const currentStep = steps[currentIndex]
  if (!currentStep) {
    finish()
    return null
  }

  if (!stepAuthReady) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground text-sm">{t('setup.loading')}</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2">
          <img src={theme === 'dark' ? logoDark : logoLight} alt="eYssen" className="h-6" />
          <span className="text-lg font-semibold">EYAS</span>
        </div>

        {/* Progress */}
        <div className="flex gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= currentIndex ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {t('setup.stepOf', { current: currentIndex + 1, total: steps.length })}
        </p>

        {/* Step form */}
        <Card className="glass-card">
          <CardContent className="pt-6">
            {currentStep.id === 'team-agents' ? (
              <TeamAgentsStep
                onSubmit={handleStepSubmit}
                isLast={currentIndex === steps.length - 1}
              />
            ) : currentStep.id === 'ai-provider' ? (
              <AiProviderStep
                isLast={currentIndex === steps.length - 1}
                onComplete={async (providerId) => {
                  if (!(await ensureAuthedForOptional(currentStep))) return
                  await api.post(`/setup/steps/ai-provider`, { providerId })
                  if (currentIndex < steps.length - 1) setCurrentIndex((i) => i + 1)
                  else finish()
                }}
              />
            ) : currentStep.id === 'ai-models' ? (
              <AiModelsStep
                isLast={currentIndex === steps.length - 1}
                onComplete={async (assignments) => {
                  if (!(await ensureAuthedForOptional(currentStep))) return
                  await api.post(`/setup/steps/ai-models`, { assignments: JSON.stringify(assignments) })
                  if (currentIndex < steps.length - 1) setCurrentIndex((i) => i + 1)
                  else finish()
                }}
              />
            ) : (
              <SetupStep
                step={currentStep}
                onSubmit={handleStepSubmit}
                isLast={currentIndex === steps.length - 1}
              />
            )}
          </CardContent>
        </Card>

        {/* Appearance — let the user pick their look right at the start (first step only) */}
        {currentIndex === 0 && (
          <div className="glass-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t('setup.appearance')}</span>
              <div className="flex gap-1">
                <Button
                  variant={theme === 'dark' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2"
                  aria-label="Dark mode"
                  onClick={() => setTheme('dark')}
                >
                  <Moon className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant={theme === 'light' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2"
                  aria-label="Light mode"
                  onClick={() => setTheme('light')}
                >
                  <Sun className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {/* Language — same explicit choice the running app uses, so the
                wizard and the app never disagree. */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t('setup.language')}</span>
              <div className="flex gap-1">
                {SUPPORTED_LANGS.map((l) => (
                  <Button
                    key={l}
                    variant={lang === l ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    aria-pressed={lang === l}
                    onClick={() => setLang(l)}
                  >
                    {LANG_SHORT[l]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={template === t.id}
                  title={t.description}
                  onClick={() => setTemplate(t.id)}
                  className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring outline-none ${
                    template === t.id ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50'
                  }`}
                >
                  <span className="flex -space-x-1">
                    {t.swatch.map((c, i) => (
                      <span key={i} className="h-3 w-3 rounded-full border border-border" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="text-[10px] text-foreground truncate max-w-full">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
