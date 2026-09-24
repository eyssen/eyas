import { RouterProvider, createRouter } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import { routeTree } from '@/routes/routeTree.gen'
import { useThemeStore } from '@/stores/theme-store'
import { useLanguageStore, applyLang } from '@/stores/language-store'
import { DEFAULT_TEMPLATE } from '@/themes/registry'
import { useEffect } from 'react'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export function App() {
  const { theme } = useThemeStore()
  const lang = useLanguageStore((s) => s.lang)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    const t = useThemeStore.getState().template
    if (t !== DEFAULT_TEMPLATE) document.documentElement.dataset.template = t
    else delete document.documentElement.dataset.template
  }, [theme])

  // Keep <html lang> in sync (belt-and-suspenders with the store's eager apply).
  useEffect(() => { applyLang(lang) }, [lang])

  // The per-module i18n `t()` helpers read the language at call time (from
  // <html lang>), so a language change only shows up where React re-renders.
  // Re-key the router on `lang` to force the whole route tree to re-render into
  // the new language. The setup wizard exposes its selector only on step 1
  // (no entered data yet), so this remount is harmless there.
  return (
    <>
      <RouterProvider key={lang} router={router} />
      {/* Sonner's renderer. Without it every toast() in the app is a silent
          no-op — including the undo affordance on destructive actions — so it
          lives here in the shell, outside the language re-key so an in-flight
          toast survives a language switch. Styled from the theme tokens rather
          than sonner's own palette, so it follows the [data-template] skins. */}
      <Toaster
        theme={theme}
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: 'bg-card border border-border text-foreground text-[11px]',
            description: 'text-muted-foreground',
            actionButton: 'bg-primary text-primary-foreground',
            cancelButton: 'bg-muted text-muted-foreground',
          },
        }}
      />
    </>
  )
}
