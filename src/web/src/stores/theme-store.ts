import { create } from 'zustand'
import { DEFAULT_TEMPLATE, isTemplateId, type TemplateId } from '@/themes/registry'

type Theme = 'dark' | 'light'

interface ThemeState {
  theme: Theme
  template: TemplateId
  toggle: () => void
  set: (theme: Theme) => void
  setTemplate: (id: TemplateId) => void
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem('eyas-theme', theme)
}

export function resolveInitialTemplate(stored: string | null): TemplateId {
  return stored && isTemplateId(stored) ? stored : DEFAULT_TEMPLATE
}

export function applyTemplate(id: TemplateId) {
  // sequoia is the default look → no attribute; others set data-template
  if (id === DEFAULT_TEMPLATE) delete document.documentElement.dataset.template
  else document.documentElement.dataset.template = id
  localStorage.setItem('eyas-template', id)
}

const storedTheme = localStorage.getItem('eyas-theme') as Theme | null
const initialTheme: Theme = storedTheme || 'dark'
const initialTemplate = resolveInitialTemplate(localStorage.getItem('eyas-template'))

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,
  template: initialTemplate,
  toggle: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return { theme: next }
    }),
  set: (theme: Theme) => {
    applyTheme(theme)
    set({ theme })
  },
  setTemplate: (id: TemplateId) => {
    applyTemplate(id)
    set({ template: id })
  },
}))
