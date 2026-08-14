import { Search } from 'lucide-react'
import { ThemeToggle } from './theme-toggle'
import { TemplateSelector } from './template-selector'
import { UserMenu } from './user-menu'
import { NotificationBell } from './notification-bell'
import { useThemeStore } from '@/stores/theme-store'
import { useSearchStore } from '@/stores/search-store'
import { t } from './i18n'
import logoDark from '@/assets/eyssen-logo-dark.png'
import logoLight from '@/assets/eyssen-logo-light.png'

export function TopBar() {
  const { theme } = useThemeStore()
  const toggleSearch = useSearchStore((s) => s.toggleOpen)

  return (
    <header className="h-12 vibrancy border-b border-[var(--vibrancy-border)] flex items-center px-4 gap-4 flex-shrink-0">
      {/* Left: Logo */}
      <div className="w-[204px] flex items-center gap-2 border-r border-[var(--vibrancy-border)] pr-4">
        <img src={theme === 'dark' ? logoDark : logoLight} alt="eYssen" className="h-5" />
        <span className="text-sm font-semibold text-foreground">EYAS</span>
      </div>

      {/* Center: Search */}
      <div className="flex-1 flex justify-center">
        <button onClick={toggleSearch} className="flex items-center gap-2 bg-accent/50 border border-input rounded-lg px-4 py-1.5 w-[320px] max-w-full text-muted-foreground text-sm hover:bg-accent transition-colors">
          <Search className="h-3.5 w-3.5" />
          <span>{t('common.search')}</span>
          <kbd className="ml-auto text-[10px] bg-background/50 px-1.5 py-0.5 rounded border border-border">⌘K</kbd>
        </button>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <TemplateSelector />
        <ThemeToggle />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  )
}
