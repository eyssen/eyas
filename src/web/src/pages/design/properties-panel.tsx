import { useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import type { DcSelection } from './types'
import { t } from './i18n'

/**
 * Edits the SELECTED element's inline styles.
 *
 * Inline styles rather than classes, deliberately: the format's own guidance is
 * that a viewer should be able to restyle anything, and only inline
 * declarations survive direct manipulation and re-serialisation.
 *
 * Every change is sent as a patch of named properties. Declarations the panel
 * does not know about — including ones whose value is a {{hole}} — are left
 * exactly as they are by the runtime's patcher.
 */

const TEXT_PROPS: { key: string; labelKey: string; placeholder?: string }[] = [
  { key: 'font-size', labelKey: 'design.props.fontSize', placeholder: '16px' },
  { key: 'font-weight', labelKey: 'design.props.fontWeight', placeholder: '400' },
  { key: 'line-height', labelKey: 'design.props.lineHeight', placeholder: '1.5' },
  { key: 'letter-spacing', labelKey: 'design.props.letterSpacing', placeholder: '0' },
  { key: 'text-align', labelKey: 'design.props.textAlign', placeholder: 'left' },
]

const BOX_PROPS: { key: string; labelKey: string; placeholder?: string }[] = [
  { key: 'padding', labelKey: 'design.props.padding', placeholder: '16px' },
  { key: 'margin', labelKey: 'design.props.margin', placeholder: '0' },
  { key: 'width', labelKey: 'design.props.width' },
  { key: 'height', labelKey: 'design.props.height' },
  { key: 'border-radius', labelKey: 'design.props.radius', placeholder: '8px' },
  { key: 'border', labelKey: 'design.props.border', placeholder: '1px solid #ddd' },
]

const LAYOUT_PROPS: { key: string; labelKey: string; placeholder?: string }[] = [
  { key: 'gap', labelKey: 'design.props.gap', placeholder: '12px' },
  { key: 'justify-content', labelKey: 'design.props.justify', placeholder: 'flex-start' },
  { key: 'align-items', labelKey: 'design.props.align', placeholder: 'stretch' },
  { key: 'flex-direction', labelKey: 'design.props.direction', placeholder: 'row' },
]

const COLOR_PROPS: { key: string; labelKey: string }[] = [
  { key: 'color', labelKey: 'design.props.color' },
  { key: 'background', labelKey: 'design.props.background' },
]

/** A grid whose tracks are equal reads and writes back as a plain column count. */
const EQUAL_TRACKS_RE = /^repeat\(\s*(\d+)\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)$/

export function trackCountOf(value: string | undefined): number | null {
  if (!value) return null
  const m = value.match(EQUAL_TRACKS_RE)
  return m ? Number(m[1]) : null
}

export function tracksFromCount(count: number): string {
  return `repeat(${count}, minmax(0, 1fr))`
}

/** A hole in a declaration means the value is computed; editing it would drop the binding. */
function isBound(value: string | undefined): boolean {
  return !!value && /\{\{[\s\S]*\}\}/.test(value)
}

export function PropertiesPanel({
  selection,
  onPatch,
  onText,
}: {
  selection: DcSelection | null
  onPatch: (styles: Record<string, string | null>) => void
  onText: (text: string) => void
}) {
  const styles = selection?.styles ?? {}
  const display = styles.display ?? ''
  const isGrid = display === 'grid'
  const isFlex = display === 'flex' || display === 'inline-flex'
  const trackCount = useMemo(() => trackCountOf(styles['grid-template-columns']), [styles])

  if (!selection) {
    return <p className="text-xs text-muted-foreground">{t('design.props.nothingSelected')}</p>
  }

  const field = ({ key, labelKey, placeholder }: { key: string; labelKey: string; placeholder?: string }) => {
    const bound = isBound(styles[key])
    return (
      <div key={key}>
        <Label htmlFor={`prop-${key}`} className="text-xs">{t(labelKey)}</Label>
        <Input
          id={`prop-${key}`}
          className="h-8"
          value={styles[key] ?? ''}
          placeholder={bound ? t('design.props.bound') : placeholder}
          disabled={bound}
          onChange={(e) => onPatch({ [key]: e.target.value || null })}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">&lt;{selection.tag}&gt;</Badge>
        <span className="text-xs text-muted-foreground">#{selection.index}</span>
      </div>

      {selection.text !== undefined && (
        <div>
          <Label htmlFor="prop-text" className="text-xs">{t('design.props.text')}</Label>
          {selection.bound ? (
            <p className="text-xs text-muted-foreground">{t('design.props.textBound')}</p>
          ) : (
            <textarea
              id="prop-text"
              className="w-full rounded-md bg-transparent border border-[hsl(var(--border))] p-2 text-sm"
              rows={3}
              value={selection.text}
              onChange={(e) => onText(e.target.value)}
            />
          )}
        </div>
      )}

      <Separator />
      <div>
        <div className="section-label mb-2">{t('design.props.colours')}</div>
        <div className="grid grid-cols-2 gap-2">
          {COLOR_PROPS.map(({ key, labelKey }) => {
            const bound = isBound(styles[key])
            const raw = styles[key] ?? ''
            const asHex = /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '#000000'
            return (
              <div key={key}>
                <Label htmlFor={`prop-${key}`} className="text-xs">{t(labelKey)}</Label>
                <div className="flex items-center gap-1">
                  <input
                    type="color"
                    aria-label={t(labelKey)}
                    className="h-8 w-8 rounded border-0 bg-transparent p-0"
                    value={asHex}
                    disabled={bound}
                    onChange={(e) => onPatch({ [key]: e.target.value })}
                  />
                  <Input
                    id={`prop-${key}`}
                    className="h-8"
                    value={raw}
                    disabled={bound}
                    placeholder={bound ? t('design.props.bound') : '#101114'}
                    onChange={(e) => onPatch({ [key]: e.target.value || null })}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Separator />
      <div>
        <div className="section-label mb-2">{t('design.props.typography')}</div>
        <div className="grid grid-cols-2 gap-2">{TEXT_PROPS.map(field)}</div>
      </div>

      <Separator />
      <div>
        <div className="section-label mb-2">{t('design.props.box')}</div>
        <div className="grid grid-cols-2 gap-2">{BOX_PROPS.map(field)}</div>
      </div>

      <Separator />
      <div>
        <div className="section-label mb-2">{t('design.props.layout')}</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="prop-display" className="text-xs">{t('design.props.display')}</Label>
            <select
              id="prop-display"
              className="h-8 w-full rounded-md bg-transparent border border-[hsl(var(--border))] px-2 text-sm"
              value={display}
              onChange={(e) => onPatch({ display: e.target.value || null })}
            >
              <option value="">{t('design.props.displayDefault')}</option>
              <option value="block">block</option>
              <option value="flex">flex</option>
              <option value="inline-flex">inline-flex</option>
              <option value="grid">grid</option>
              <option value="none">none</option>
            </select>
          </div>
          {isGrid && (
            <div>
              <Label htmlFor="prop-tracks" className="text-xs">{t('design.props.columns')}</Label>
              <Input
                id="prop-tracks"
                className="h-8"
                type="number"
                min={1}
                max={12}
                value={trackCount ?? ''}
                placeholder={styles['grid-template-columns'] ? t('design.props.customTracks') : '3'}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  onPatch({ 'grid-template-columns': Number.isFinite(n) && n > 0 ? tracksFromCount(n) : null })
                }}
              />
            </div>
          )}
          {(isFlex || isGrid) && LAYOUT_PROPS.map(field)}
        </div>
        {isGrid && trackCount === null && styles['grid-template-columns'] && (
          <p className="text-xs text-muted-foreground mt-1">{t('design.props.customTracksHint')}</p>
        )}
      </div>
    </div>
  )
}
