import { useState } from 'react'
import { Palette, Check } from 'lucide-react'
import { useThemeStore } from '@/stores/theme-store'
import { TEMPLATES } from '@/themes/registry'
import { t } from './i18n'

export function TemplateSelector() {
  const { template, setTemplate } = useThemeStore()
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        aria-label={t('templateSelector.chooseTemplate')}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-accent transition-colors text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none"
      >
        <Palette className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-64 z-50 glass-card p-1.5" role="menu">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                role="menuitemradio"
                aria-checked={template === tpl.id}
                onClick={() => { setTemplate(tpl.id); setOpen(false) }}
                className="w-full flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent transition-colors text-left"
              >
                <span className="flex -space-x-1">
                  {tpl.swatch.map((c, i) => (
                    <span key={i} className="h-3.5 w-3.5 rounded-full border border-border" style={{ background: c }} />
                  ))}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground">{tpl.label}</span>
                  <span className="block text-[11px] text-muted-foreground truncate">{tpl.description}</span>
                </span>
                {template === tpl.id && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
