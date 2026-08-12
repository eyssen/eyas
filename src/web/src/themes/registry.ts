export type TemplateId = 'sequoia' | 'nebula' | 'atelier' | 'halo' | 'terminal'

export interface TemplateMeta {
  id: TemplateId
  label: string
  description: string
  /** three representative colors for the selector swatch */
  swatch: [string, string, string]
}

export const DEFAULT_TEMPLATE: TemplateId = 'sequoia'

export const TEMPLATES: TemplateMeta[] = [
  { id: 'sequoia',  label: 'Sequoia',  description: 'Frosted-glass vibrancy — the original EYAS look', swatch: ['#0a0a14', '#5b6cff', '#ffffff'] },
  { id: 'nebula',   label: 'Nebula',   description: 'Cosmic dark, aurora glow, glass panels',   swatch: ['#06070d', '#7c5cff', '#22d3ee'] },
  { id: 'atelier',  label: 'Atelier',  description: 'Light editorial luxe, serif display',       swatch: ['#f7f2e9', '#c8281c', '#14100a'] },
  { id: 'halo',     label: 'Halo',     description: 'Spatial depth, floating frosted panels',     swatch: ['#111721', '#5ad7e6', '#6ea6fe'] },
  { id: 'terminal', label: 'Terminal', description: 'Neo-brutalist dev tool, monospace',          swatch: ['#f0ede4', '#16150f', '#e5231b'] },
]

const IDS = new Set<string>(TEMPLATES.map(t => t.id))
export function isTemplateId(x: string): x is TemplateId {
  return IDS.has(x)
}
