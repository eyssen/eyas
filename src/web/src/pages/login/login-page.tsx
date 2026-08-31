import { useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { useThemeStore } from '@/stores/theme-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import logoDark from '@/assets/eyssen-logo-dark.png'
import logoLight from '@/assets/eyssen-logo-light.png'
import mascotImg from '@/assets/mascot.png'
import { t } from './i18n'

export default function LoginPage() {
  const navigate = useNavigate()
  const { redirect } = useSearch({ from: '/login' })
  const { login } = useAuthStore()
  const { theme } = useThemeStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username, password)
      const safeRedirect =
        redirect && redirect.startsWith('/') && !redirect.startsWith('//') && !redirect.startsWith('/\\')
          ? redirect
          : '/'
      navigate({ to: safeRedirect })
    } catch (err: any) {
      setError(err.message || t('login.invalidCredentials'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center p-4 relative overflow-hidden">
      {/* Warm glow behind mascot */}
      <div className="absolute top-[12%] right-[22%] w-[300px] h-[300px] rounded-full bg-amber-500/[0.04] blur-[60px] pointer-events-none" />

      <div className="w-full max-w-sm space-y-6 relative">
        {/* Mascot — floating above the card, right side */}
        <div className="relative h-0">
          <img
            src={mascotImg}
            alt={t('login.mascotAlt')}
            className="absolute -top-[140px] -right-[100px] w-[200px] pointer-events-none select-none animate-[mascot-float_12s_ease-in-out_infinite]"
            style={{
              filter: 'drop-shadow(0 0 30px rgba(251, 191, 36, 0.12)) drop-shadow(0 0 60px rgba(251, 191, 36, 0.06))',
              transformOrigin: 'center center',
            }}
          />
        </div>

        <div className="flex items-center justify-center gap-2">
          <img src={theme === 'dark' ? logoDark : logoLight} alt="eYssen" className="h-6" />
          <span className="text-lg font-semibold">EYAS</span>
        </div>

        <Card className="glass-card">
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="text-center mb-4">
                <h2 className="text-lg font-semibold">{t('login.signIn')}</h2>
                <p className="text-sm text-muted-foreground">{t('login.subtitle')}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="username">{t('login.username')}</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder={t('login.usernamePlaceholder')}
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">{t('login.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? t('login.signingIn') : t('login.signIn')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
