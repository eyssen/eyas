// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type {
  CardinalityWarning,
  HistogramOptions,
  HistogramSample,
  LabelSet,
  MetricFamily,
  MetricOptions,
  Sample,
  SampleKey,
} from './types.js'

/** Default maximum number of unique label sets per metric family. */
export const DEFAULT_MAX_CARDINALITY = 10_000

/** Stable key for a label-set. Labels are sorted so ordering does not matter. */
export function labelKey(labels: LabelSet): SampleKey {
  const keys = Object.keys(labels).sort()
  if (keys.length === 0) return ''
  return keys.map((k) => `${k}=${labels[k]}`).join(',')
}

/**
 * Validate label names against Prometheus rules:
 *  - must start with [a-zA-Z_]
 *  - must contain only [a-zA-Z0-9_]
 *  - must not start with "__" (reserved)
 */
export function validateLabelName(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid Prometheus label name: ${name}`)
  }
  if (name.startsWith('__')) {
    throw new Error(`Label name starts with reserved __ prefix: ${name}`)
  }
}

/** Validate a metric name — similar rules, but allows ":". */
export function validateMetricName(name: string): void {
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) {
    throw new Error(`Invalid Prometheus metric name: ${name}`)
  }
}

interface BaseMetricState {
  name: string
  help: string
  labelNames: string[]
}

abstract class BaseMetric implements BaseMetricState {
  public readonly name: string
  public readonly help: string
  public readonly labelNames: string[]

  constructor(opts: MetricOptions) {
    validateMetricName(opts.name)
    for (const l of opts.labelNames ?? []) validateLabelName(l)
    this.name = opts.name
    this.help = opts.help
    this.labelNames = opts.labelNames ?? []
  }

  abstract collect(): MetricFamily

  /** Reset the metric to its initial (empty) state — used primarily by tests. */
  abstract reset(): void
}

/**
 * Monotonic counter — can only increase (or be reset to zero).
 * Negative increments throw; this matches prom-client semantics.
 */
export class Counter extends BaseMetric {
  private values = new Map<SampleKey, { labels: LabelSet; value: number }>()
  private cardinalityDropped = false

  inc(labels: LabelSet = {}, amount = 1): void {
    if (amount < 0) {
      throw new Error(`Counter ${this.name} does not accept negative increments`)
    }
    const key = this.ensureLabels(labels)
    if (key === null) return // cardinality guard
    const existing = this.values.get(key)
    if (existing) existing.value += amount
    else this.values.set(key, { labels, value: amount })
  }

  get(labels: LabelSet = {}): number {
    return this.values.get(labelKey(labels))?.value ?? 0
  }

  override collect(): MetricFamily {
    const samples: Sample[] = []
    for (const { labels, value } of this.values.values()) {
      samples.push({ labels, value })
    }
    return { name: this.name, help: this.help, type: 'counter', samples }
  }

  override reset(): void {
    this.values.clear()
    this.cardinalityDropped = false
  }

  /**
   * Ensure labels fit within the registry cardinality cap.
   * Returns the label key, or null if this sample was dropped.
   */
  private maxCardinality = DEFAULT_MAX_CARDINALITY
  private onCardinalityWarning?: (w: CardinalityWarning) => void

  /** Internal hook used by Registry to configure cardinality guardrails. */
  _configureCardinality(max: number, cb: (w: CardinalityWarning) => void): void {
    this.maxCardinality = max
    this.onCardinalityWarning = cb
  }

  protected ensureLabels(labels: LabelSet): SampleKey | null {
    const key = labelKey(labels)
    if (this.values.has(key)) return key
    if (this.values.size >= this.maxCardinality) {
      if (!this.cardinalityDropped) {
        this.cardinalityDropped = true
        this.onCardinalityWarning?.({
          metricName: this.name,
          droppedLabel: Object.keys(labels)[0] ?? '<unlabeled>',
          firstSeenAt: Date.now(),
        })
      }
      return null
    }
    return key
  }
}

/**
 * Gauge — arbitrary floating-point value that can go up or down.
 */
export class Gauge extends BaseMetric {
  private values = new Map<SampleKey, { labels: LabelSet; value: number }>()
  private maxCardinality = DEFAULT_MAX_CARDINALITY
  private cardinalityDropped = false
  private onCardinalityWarning?: (w: CardinalityWarning) => void

  set(labels: LabelSet, value: number): void {
    const key = this.guardCardinality(labels)
    if (key === null) return
    this.values.set(key, { labels, value })
  }

  inc(labels: LabelSet = {}, amount = 1): void {
    const key = this.guardCardinality(labels)
    if (key === null) return
    const existing = this.values.get(key)
    if (existing) existing.value += amount
    else this.values.set(key, { labels, value: amount })
  }

  dec(labels: LabelSet = {}, amount = 1): void {
    this.inc(labels, -amount)
  }

  get(labels: LabelSet = {}): number {
    return this.values.get(labelKey(labels))?.value ?? 0
  }

  override collect(): MetricFamily {
    const samples: Sample[] = []
    for (const { labels, value } of this.values.values()) {
      samples.push({ labels, value })
    }
    return { name: this.name, help: this.help, type: 'gauge', samples }
  }

  override reset(): void {
    this.values.clear()
    this.cardinalityDropped = false
  }

  _configureCardinality(max: number, cb: (w: CardinalityWarning) => void): void {
    this.maxCardinality = max
    this.onCardinalityWarning = cb
  }

  private guardCardinality(labels: LabelSet): SampleKey | null {
    const key = labelKey(labels)
    if (this.values.has(key)) return key
    if (this.values.size >= this.maxCardinality) {
      if (!this.cardinalityDropped) {
        this.cardinalityDropped = true
        this.onCardinalityWarning?.({
          metricName: this.name,
          droppedLabel: Object.keys(labels)[0] ?? '<unlabeled>',
          firstSeenAt: Date.now(),
        })
      }
      return null
    }
    return key
  }
}

interface HistogramBucketEntry {
  labels: LabelSet
  buckets: number[] // running counts, aligned with `bounds`
  sum: number
  count: number
}

/**
 * Histogram — tracks observations in predefined buckets.
 * Emits `<name>_bucket{le="..."}`, `<name>_sum`, `<name>_count` in scrape.
 */
export class Histogram extends BaseMetric {
  public readonly bounds: number[]
  private values = new Map<SampleKey, HistogramBucketEntry>()
  private maxCardinality = DEFAULT_MAX_CARDINALITY
  private cardinalityDropped = false
  private onCardinalityWarning?: (w: CardinalityWarning) => void

  constructor(opts: HistogramOptions) {
    super(opts)
    if (!Array.isArray(opts.buckets) || opts.buckets.length === 0) {
      throw new Error(`Histogram ${opts.name} requires non-empty buckets`)
    }
    // Validate monotonic ascending.
    for (let i = 1; i < opts.buckets.length; i++) {
      if (opts.buckets[i] <= opts.buckets[i - 1]) {
        throw new Error(`Histogram ${opts.name} buckets must be strictly ascending`)
      }
    }
    this.bounds = [...opts.buckets]
  }

  observe(labels: LabelSet, value: number): void {
    const key = this.guardCardinality(labels)
    if (key === null) return
    let entry = this.values.get(key)
    if (!entry) {
      entry = {
        labels,
        buckets: new Array(this.bounds.length).fill(0),
        sum: 0,
        count: 0,
      }
      this.values.set(key, entry)
    }
    entry.sum += value
    entry.count += 1
    for (let i = 0; i < this.bounds.length; i++) {
      if (value <= this.bounds[i]) entry.buckets[i] += 1
    }
  }

  override collect(): MetricFamily {
    const histogramSamples: HistogramSample[] = []
    for (const entry of this.values.values()) {
      const bucketMap: Record<string, number> = {}
      for (let i = 0; i < this.bounds.length; i++) {
        bucketMap[String(this.bounds[i])] = entry.buckets[i]
      }
      bucketMap['+Inf'] = entry.count
      histogramSamples.push({
        labels: entry.labels,
        value: entry.count,
        buckets: bucketMap,
        sum: entry.sum,
        count: entry.count,
      })
    }
    return {
      name: this.name,
      help: this.help,
      type: 'histogram',
      samples: [],
      histogramSamples,
    }
  }

  override reset(): void {
    this.values.clear()
    this.cardinalityDropped = false
  }

  _configureCardinality(max: number, cb: (w: CardinalityWarning) => void): void {
    this.maxCardinality = max
    this.onCardinalityWarning = cb
  }

  private guardCardinality(labels: LabelSet): SampleKey | null {
    const key = labelKey(labels)
    if (this.values.has(key)) return key
    if (this.values.size >= this.maxCardinality) {
      if (!this.cardinalityDropped) {
        this.cardinalityDropped = true
        this.onCardinalityWarning?.({
          metricName: this.name,
          droppedLabel: Object.keys(labels)[0] ?? '<unlabeled>',
          firstSeenAt: Date.now(),
        })
      }
      return null
    }
    return key
  }
}

/**
 * Registry — holds all metrics in a process and knows how to collect them.
 * Thread-safe for single-process (JS runtime) use.
 */
export class Registry {
  private metrics = new Map<string, BaseMetric>()
  private warnings: CardinalityWarning[] = []
  private readonly maxCardinality: number

  constructor(opts: { maxCardinality?: number } = {}) {
    this.maxCardinality = opts.maxCardinality ?? DEFAULT_MAX_CARDINALITY
  }

  register<T extends BaseMetric>(metric: T): T {
    if (this.metrics.has(metric.name)) {
      throw new Error(`Metric already registered: ${metric.name}`)
    }
    // Install cardinality guard.
    ;(metric as unknown as {
      _configureCardinality: (m: number, cb: (w: CardinalityWarning) => void) => void
    })._configureCardinality(this.maxCardinality, (w) => {
      this.warnings.push(w)
    })
    this.metrics.set(metric.name, metric)
    return metric
  }

  get(name: string): BaseMetric | undefined {
    return this.metrics.get(name)
  }

  /** Collect all metric families (raw) — useful for tests and custom formatters. */
  collect(): MetricFamily[] {
    const out: MetricFamily[] = []
    for (const m of this.metrics.values()) out.push(m.collect())
    return out
  }

  /** Return and clear accumulated cardinality warnings. */
  drainWarnings(): CardinalityWarning[] {
    const out = this.warnings
    this.warnings = []
    return out
  }

  /** Peek at warnings without clearing. */
  peekWarnings(): readonly CardinalityWarning[] {
    return this.warnings
  }

  /** Remove all metrics — destructive; mainly for tests. */
  clear(): void {
    this.metrics.clear()
    this.warnings = []
  }

  /** List registered metric names. */
  listMetrics(): string[] {
    return [...this.metrics.keys()]
  }
}
