// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { t } from '../i18n'

// Anchors are markdown headers inserted into the file body (not translated);
// labelKey resolves to the displayed section name at render time.
const IDENTITY_SECTIONS = [
  { anchor: '## Who I am', labelKey: 'agents.identity.section.whoIAm' },
  { anchor: '## My mission', labelKey: 'agents.identity.section.myMission' },
  { anchor: '## Ongoing proactive duties', labelKey: 'agents.identity.section.proactiveDuties' },
  { anchor: '## When to escalate', labelKey: 'agents.identity.section.whenToEscalate' },
  { anchor: '## When to refuse', labelKey: 'agents.identity.section.whenToRefuse' },
]

interface Props {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}

export function IdentityEditor({ value, onChange, disabled }: Props) {
  return (
    <div className="flex gap-4 min-h-[320px]">
      {/* TOC sidebar */}
      <div className="w-40 flex-shrink-0 pt-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">{t('agents.identity.sections')}</div>
        <ul className="space-y-1">
          {IDENTITY_SECTIONS.map((s) => (
            <li key={s.anchor}>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground text-left leading-snug w-full"
                onClick={() => {
                  // Insert section header if missing
                  if (!value.includes(s.anchor)) {
                    onChange(value + (value.endsWith('\n') ? '' : '\n') + '\n' + s.anchor + '\n\n')
                  }
                }}
                title={t('agents.identity.jumpTitle', { anchor: s.anchor })}
              >
                {t(s.labelKey)}
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-muted-foreground/60 mt-3 leading-tight">
          {t('agents.identity.hint')}
        </p>
      </div>

      {/* Editor */}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="flex-1 min-h-[320px] rounded-md border border-border/50 bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-y"
        placeholder={IDENTITY_SECTIONS.map((s) => s.anchor + '\n\n').join('\n')}
        spellCheck={false}
      />
    </div>
  )
}
