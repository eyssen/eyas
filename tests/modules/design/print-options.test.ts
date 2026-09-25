// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  CSS_PX_PER_INCH,
  MAX_PNG_PIXELS,
  PAPERS,
  frameOf,
  pdfOptionsFor,
  pngOptionsFor,
  printModeOf,
  pxToIn,
} from '@modules/design/print-options'

describe('paper sizes', () => {
  it('states A4 and Letter at 96 css px per inch', () => {
    expect(CSS_PX_PER_INCH).toBe(96)
    // Letter is exactly 8.5 x 11in, so it is the one with no rounding to hide behind.
    expect(PAPERS.letter.widthPx).toBe(8.5 * 96)
    expect(PAPERS.letter.heightPx).toBe(11 * 96)
    expect(pxToIn(PAPERS.a4.widthPx)).toBeCloseTo(8.268, 2)
    expect(pxToIn(PAPERS.a4.heightPx)).toBeCloseTo(11.693, 2)
  })
})

describe('printModeOf', () => {
  it('defaults to fixed, matching the canvas format', () => {
    expect(printModeOf(undefined)).toBe('fixed')
    expect(printModeOf({ file: 'a.dc.html', x: 0, y: 0, w: 1, h: 1 })).toBe('fixed')
  })
  it('honours an explicit flow', () => {
    expect(printModeOf({ file: 'a.dc.html', x: 0, y: 0, w: 1, h: 1, print: 'flow' })).toBe('flow')
  })
})

describe('frameOf', () => {
  const entry = { file: 'a.dc.html', x: 0, y: 0, w: 640, h: 480 }

  it('prefers the canvas.json frame', () => {
    expect(frameOf(entry, { width: 100, height: 100 })).toEqual({ width: 640, height: 480 })
  })

  it('falls back to the artboard $preview when the canvas does not place it', () => {
    expect(frameOf(undefined, { width: 390, height: 844 })).toEqual({ width: 390, height: 844 })
  })

  it('falls back again to a usable default', () => {
    expect(frameOf(undefined, undefined)).toEqual({ width: 800, height: 600 })
  })

  it('ignores a nonsense frame from a hand-edited canvas.json', () => {
    // The schema only asks for a finite number, so 0 and -5 both get through it.
    expect(frameOf({ ...entry, w: 0, h: 480 }, undefined)).toEqual({ width: 800, height: 480 })
    expect(frameOf({ ...entry, w: 640, h: -5 }, undefined)).toEqual({ width: 640, height: 600 })
  })
})

describe('pdfOptionsFor — fixed', () => {
  const opts = pdfOptionsFor({ mode: 'fixed', frame: { width: 794, height: 1123 }, paper: 'a4' })

  it('prints at the artboard size, in css px, which is exactly 1/96 inch', () => {
    expect(opts.width).toBe('794px')
    expect(opts.height).toBe('1123px')
    expect(opts.format).toBeUndefined()
  })

  it('never adds a margin — a poster has no margin', () => {
    expect(opts.margin).toEqual({ top: '0', right: '0', bottom: '0', left: '0' })
  })

  it('caps the output at one page, so a rounding overflow cannot add a blank one', () => {
    expect(opts.pageRanges).toBe('1')
  })

  it('keeps the backgrounds', () => {
    expect(opts.printBackground).toBe(true)
  })

  it('ignores the paper choice entirely', () => {
    const letter = pdfOptionsFor({ mode: 'fixed', frame: { width: 794, height: 1123 }, paper: 'letter' })
    expect(letter.width).toBe('794px')
    expect(letter.format).toBeUndefined()
  })
})

describe('pdfOptionsFor — flow', () => {
  it('uses the chosen paper and paginates', () => {
    const opts = pdfOptionsFor({ mode: 'flow', frame: { width: 680, height: 2000 }, paper: 'a4' })
    expect(opts.format).toBe('A4')
    expect(opts.width).toBeUndefined()
    expect(opts.height).toBeUndefined()
    expect(opts.pageRanges).toBeUndefined()
  })

  it('leaves a readable margin by default', () => {
    const opts = pdfOptionsFor({ mode: 'flow', frame: { width: 680, height: 2000 }, paper: 'a4' })
    expect(opts.margin.top).toBe('12mm')
  })

  it('shrinks a column that is wider than the printable area', () => {
    // A4 is 794px wide; 12mm each side is ~91px, leaving ~703px printable.
    const opts = pdfOptionsFor({ mode: 'flow', frame: { width: 1400, height: 3000 }, paper: 'a4' })
    expect(opts.scale).toBeLessThan(1)
    expect(opts.scale).toBeGreaterThan(0.4)
  })

  it('never magnifies a narrow column — the author chose that width', () => {
    const opts = pdfOptionsFor({ mode: 'flow', frame: { width: 320, height: 1200 }, paper: 'a4' })
    expect(opts.scale).toBe(1)
  })

  it("stays inside Playwright's 0.1-2 scale range even for an absurd column", () => {
    const opts = pdfOptionsFor({ mode: 'flow', frame: { width: 100_000, height: 200 }, paper: 'a4' })
    expect(opts.scale).toBeGreaterThanOrEqual(0.1)
  })

  it('respects a caller-supplied margin', () => {
    const opts = pdfOptionsFor({ mode: 'flow', frame: { width: 680, height: 900 }, paper: 'letter', marginMm: 0 })
    expect(opts.margin).toEqual({ top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' })
    expect(opts.format).toBe('Letter')
  })
})

describe('pngOptionsFor', () => {
  it('captures a fixed artboard at exactly its frame', () => {
    const opts = pngOptionsFor({ mode: 'fixed', frame: { width: 640, height: 480 } })
    expect(opts.viewport).toEqual({ width: 640, height: 480 })
    expect(opts.fullPage).toBe(false)
    expect(opts.deviceScaleFactor).toBe(1)
  })

  it('captures the whole scroll height of a flow artboard', () => {
    const opts = pngOptionsFor({ mode: 'flow', frame: { width: 680, height: 900 } })
    expect(opts.fullPage).toBe(true)
  })

  it('doubles the pixels for a retina export', () => {
    const opts = pngOptionsFor({ mode: 'fixed', frame: { width: 400, height: 300 }, scale: 2 })
    expect(opts.deviceScaleFactor).toBe(2)
  })

  it('backs the scale off rather than asking Chromium for a 100-megapixel bitmap', () => {
    const opts = pngOptionsFor({ mode: 'fixed', frame: { width: 4000, height: 4000 }, scale: 3 })
    expect(opts.viewport.width * opts.viewport.height * opts.deviceScaleFactor ** 2).toBeLessThanOrEqual(MAX_PNG_PIXELS)
    expect(opts.deviceScaleFactor).toBeGreaterThanOrEqual(1)
  })

  it('clamps a frame that is larger than Chromium will texture', () => {
    const opts = pngOptionsFor({ mode: 'fixed', frame: { width: 40_000, height: 100 } })
    expect(opts.viewport.width).toBeLessThanOrEqual(10_000)
  })

  it('rejects a nonsense scale instead of passing it through', () => {
    expect(pngOptionsFor({ mode: 'fixed', frame: { width: 100, height: 100 }, scale: 0 }).deviceScaleFactor).toBe(1)
    expect(pngOptionsFor({ mode: 'fixed', frame: { width: 100, height: 100 }, scale: 99 }).deviceScaleFactor).toBe(3)
  })
})
