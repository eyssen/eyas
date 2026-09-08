/** Mirrors src/modules/design/types.ts — structural on purpose; the backend validates. */
export interface DesignRow {
  id: string
  title: string
  slug: string
  kind: string
  tags: string[]
  currentVersion: number
  createdAt: string
  updatedAt: string
}

export interface ArtboardEntry {
  file: string
  x: number
  y: number
  w: number
  h: number
  title?: string
  page?: string
  print?: 'fixed' | 'flow'
  is_interactive?: boolean
}

export interface CanvasAnnotation {
  id: string
  x: number
  y: number
  w: number
  text: string
  page?: string
  color?: string
}

export interface CanvasManifest {
  artboards?: ArtboardEntry[]
  annotations?: CanvasAnnotation[]
  pages?: { id: string; name: string }[]
  launch?: { view: 'canvas'; page?: string } | { view: 'focused'; file: string }
}

export interface Design extends DesignRow {
  files: Record<string, string>
  manifest: CanvasManifest
  artboards: string[]
}

export interface DesignVersion {
  version: number
  origin: string
  createdAt: string
  createdBy: string | null
  changeNote: string | null
}

export interface RenderedArtboard {
  srcdoc: string
  sandbox: string
  propsSpec: Record<string, PropSpec>
  preview?: { width?: number; height?: number }
}

export interface ValidationIssue {
  code: string
  path?: string
  message: string
}

export interface DcSelection {
  index: number
  tag: string
  styles: Record<string, string>
  text?: string
  /** Bound text ({{hole}}) cannot be edited in place. */
  bound?: boolean
}

export interface PropSpec {
  editor?: 'text' | 'color' | 'int' | 'float' | 'range' | 'boolean' | 'enum' | null
  default?: unknown
  options?: unknown[]
  min?: number
  max?: number
  step?: number
}

/** Mirrors src/modules/design/design-ai-runs.ts. Times are epoch ms. */
export type DesignAiRunStatus = 'running' | 'ok' | 'failed' | 'interrupted'

export interface DesignAiRun {
  id: string
  designId: string
  instruction: string
  targetFile: string | null
  status: DesignAiRunStatus
  tier: string | null
  attempts: number | null
  message: string | null
  versionBefore: number | null
  versionAfter: number | null
  startedAt: number
  finishedAt: number | null
  durationMs: number | null
  createdBy: string | null
}

/** Who holds on to a design; travels with `GET /designs/:id`. */
export interface DesignLinkSummary {
  total: number
  byModule: Record<string, number>
}
