// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/print-options.ts
//
// The arithmetic between "an artboard on a canvas" and "a page in a PDF".
//
// Pure on purpose. Everything that can be got wrong about a print export —
// the unit conversion, the one-page cap, the pagination scale, the pixel
// ceiling — is decided here, where it can be tested without a browser.
//
// The unit that matters: a CSS pixel is exactly 1/96 inch, and Chromium's PDF
// writer honours `px` in page.pdf() as CSS px. Passing px through therefore
// needs no conversion and introduces no rounding, which is why the fixed path
// emits px rather than the inches the spec describes them as.

import type { ArtboardEntry } from './canvas-schema.js'

export const CSS_PX_PER_INCH = 96
export const MM_PER_INCH = 25.4

/** Chromium will not composite an arbitrarily large surface; stay well under. */
export const MAX_PNG_SIDE = 10_000
export const MAX_PNG_PIXELS = 40_000_000

export function pxToIn(px: number): number {
  return px / CSS_PX_PER_INCH
}

export function mmToPx(mm: number): number {
  return (mm / MM_PER_INCH) * CSS_PX_PER_INCH
}

export const PAPERS = {
  a4: { widthPx: 794, heightPx: 1123, format: 'A4' },
  letter: { widthPx: 816, heightPx: 1056, format: 'Letter' },
  a3: { widthPx: 1123, heightPx: 1587, format: 'A3' },
  a5: { widthPx: 559, heightPx: 794, format: 'A5' },
} as const

export type PaperChoice = keyof typeof PAPERS
export const PAPER_CHOICES = Object.keys(PAPERS) as PaperChoice[]
export const DEFAULT_PAPER: PaperChoice = 'a4'
export const DEFAULT_MARGIN_MM = 12

export interface Frame {
  width: number
  height: number
}

export type PrintMode = 'fixed' | 'flow'

/** `print` is optional in canvas.json and defaults to fixed, as in the format. */
export function printModeOf(entry: ArtboardEntry | undefined): PrintMode {
  return entry?.print === 'flow' ? 'flow' : 'fixed'
}

const FALLBACK_FRAME: Frame = { width: 800, height: 600 }

function usable(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * The frame to print at: the canvas placement, then the artboard's own
 * `$preview` hint, then a default. Each dimension falls back independently,
 * because canvas.json's schema accepts 0 and negatives and a hand edit can
 * leave one of them broken without the other.
 */
export function frameOf(
  entry: ArtboardEntry | undefined,
  preview: { width?: number; height?: number } | undefined,
): Frame {
  const width = usable(entry?.w) ? entry!.w : usable(preview?.width) ? preview!.width! : FALLBACK_FRAME.width
  const height = usable(entry?.h) ? entry!.h : usable(preview?.height) ? preview!.height! : FALLBACK_FRAME.height
  return { width, height }
}

export interface PdfArgs {
  mode: PrintMode
  frame: Frame
  paper?: PaperChoice
  marginMm?: number
}

export interface PdfOptions {
  printBackground: true
  margin: { top: string; right: string; bottom: string; left: string }
  width?: string
  height?: string
  format?: string
  scale?: number
  pageRanges?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function pdfOptionsFor(args: PdfArgs): PdfOptions {
  if (args.mode === 'fixed') {
    // One page, exactly the artboard. pageRanges is not belt-and-braces: a
    // fractional overflow of a single pixel produces a second, blank page, and
    // a blank trailing page in a poster export looks like a bug in the design.
    return {
      printBackground: true,
      width: `${args.frame.width}px`,
      height: `${args.frame.height}px`,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      pageRanges: '1',
    }
  }

  const paper = PAPERS[args.paper ?? DEFAULT_PAPER]
  const marginMm = args.marginMm ?? DEFAULT_MARGIN_MM
  const printableWidth = paper.widthPx - 2 * mmToPx(marginMm)
  // Shrink an over-wide column to fit; never magnify a narrow one. The author
  // picked that width, and blowing a 320px column up to fill A4 is not what
  // they asked for.
  const scale = clamp(Math.min(1, printableWidth / args.frame.width), 0.1, 2)

  return {
    printBackground: true,
    format: paper.format,
    margin: {
      top: `${marginMm}mm`,
      right: `${marginMm}mm`,
      bottom: `${marginMm}mm`,
      left: `${marginMm}mm`,
    },
    scale,
  }
}

export interface PngArgs {
  mode: PrintMode
  frame: Frame
  /** Device pixel ratio: 1, 2 or 3. */
  scale?: number
}

export interface PngOptions {
  viewport: Frame
  deviceScaleFactor: number
  fullPage: boolean
}

export function pngOptionsFor(args: PngArgs): PngOptions {
  const viewport: Frame = {
    width: Math.max(1, Math.min(MAX_PNG_SIDE, Math.round(args.frame.width))),
    height: Math.max(1, Math.min(MAX_PNG_SIDE, Math.round(args.frame.height))),
  }

  let dsf = Number.isFinite(args.scale) ? clamp(Math.round(args.scale as number), 1, 3) : 1
  if (!Number.isFinite(dsf) || dsf < 1) dsf = 1
  // Back the scale off rather than handing Chromium a surface it will refuse
  // to allocate — a failed screenshot is worse than a 1x one.
  while (dsf > 1 && viewport.width * viewport.height * dsf * dsf > MAX_PNG_PIXELS) dsf--

  return { viewport, deviceScaleFactor: dsf, fullPage: args.mode === 'flow' }
}
