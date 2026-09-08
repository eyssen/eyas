import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Pin } from 'lucide-react'
import type { PropSpec } from './types'
import { t } from './i18n'

/**
 * The `data-props` editors, above the frame.
 *
 * A change re-renders the artboard live; pinning writes the current value back
 * as the artboard's declared default, which is what makes a tweak a decision
 * rather than a preview.
 */
export function TweakChips({
  specs,
  values,
  onChange,
  onPin,
  busy,
}: {
  specs: Record<string, PropSpec>
  values: Record<string, unknown>
  onChange: (prop: string, value: unknown) => void
  onPin: (prop: string, value: unknown) => void
  busy?: boolean
}) {
  const editable = Object.entries(specs).filter(([, spec]) => spec && spec.editor !== null && spec.editor !== undefined)
  if (editable.length === 0) return null

  return (
    <div className="flex flex-wrap items-end gap-3">
      {editable.map(([prop, spec]) => {
        const value = values[prop] ?? spec.default ?? ''
        const id = `tweak-${prop}`
        return (
          <div key={prop} className="flex items-end gap-1">
            <div>
              <Label htmlFor={id} className="text-xs">{prop}</Label>
              {spec.editor === 'color' ? (
                <div className="flex items-center gap-1">
                  <input
                    type="color"
                    id={id}
                    aria-label={prop}
                    className="h-8 w-8 rounded border-0 bg-transparent p-0"
                    value={/^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value) : '#000000'}
                    onChange={(e) => onChange(prop, e.target.value)}
                  />
                  <Input className="h-8 w-24" value={String(value)} onChange={(e) => onChange(prop, e.target.value)} />
                </div>
              ) : spec.editor === 'boolean' ? (
                <label className="flex h-8 items-center gap-1 text-sm">
                  <input
                    id={id}
                    type="checkbox"
                    checked={value === true}
                    onChange={(e) => onChange(prop, e.target.checked)}
                  />
                  {String(value === true)}
                </label>
              ) : spec.editor === 'enum' ? (
                <select
                  id={id}
                  className="h-8 rounded-md bg-transparent border border-[hsl(var(--border))] px-2 text-sm"
                  value={String(value)}
                  onChange={(e) => onChange(prop, e.target.value)}
                >
                  {(spec.options ?? []).map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                </select>
              ) : spec.editor === 'int' || spec.editor === 'float' || spec.editor === 'range' ? (
                <Input
                  id={id}
                  className="h-8 w-24"
                  type="number"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step ?? (spec.editor === 'int' ? 1 : 'any')}
                  value={String(value)}
                  onChange={(e) => onChange(prop, spec.editor === 'int' ? parseInt(e.target.value, 10) : Number(e.target.value))}
                />
              ) : (
                <Input id={id} className="h-8 w-40" value={String(value)} onChange={(e) => onChange(prop, e.target.value)} />
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              title={t('design.tweaks.pin')}
              aria-label={t('design.tweaks.pin')}
              disabled={busy}
              onClick={() => onPin(prop, value)}
            >
              <Pin className="h-3.5 w-3.5" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
