// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { CanvasManifest } from './canvas-schema.js'

export const DESIGN_KINDS = ['ui', 'landing', 'print', 'deck', 'wireframe', 'freeform'] as const
export type DesignKind = (typeof DESIGN_KINDS)[number]

export const DESIGN_ORIGINS = ['manual', 'ai', 'import'] as const
export type DesignOrigin = (typeof DESIGN_ORIGINS)[number]

export interface DesignRow {
  id: string
  title: string
  slug: string
  kind: DesignKind
  tags: string[]
  currentVersion: number
  createdAt: string
  updatedAt: string
}

export interface Design extends DesignRow {
  files: Record<string, string>
  manifest: CanvasManifest
  artboards: string[]
}

export interface DesignVersion {
  id: number
  designId: string
  version: number
  origin: DesignOrigin
  createdAt: string
  createdBy: string | null
  changeNote: string | null
}

export interface DesignLink {
  designId: string
  ownerModule: string
  ownerId: string
  source: string
  createdAt: string
}
