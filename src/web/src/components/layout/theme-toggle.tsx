import { Moon, Sun } from 'lucide-react'
import { useThemeStore } from '@/stores/theme-store'
import { Button } from '@/components/ui/button'
import { t } from './i18n'

export function ThemeToggle() {
  const { theme, toggle } = useThemeStore()
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={t('themeToggle.label')} className="h-8 w-8 text-muted-foreground hover:text-foreground">
      {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </Button>
  )
}
