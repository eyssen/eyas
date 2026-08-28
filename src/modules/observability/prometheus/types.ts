// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Prometheus metric types supported by the EYAS registry.
 * Summary is intentionally omitted — histograms cover the same use-cases.
 */
export type MetricType = 'counter' | 'gauge' | 'histogram'

/** A label set is a flat string-to-string map. Null/undefined labels are rejected. */
export type LabelSet = Record<string, string>

/** Key used for the internal sample map (deterministic serialization of labels). */
export type SampleKey = string

export interface MetricOptions {
  name: string
  help: string
  /** Declared label names in the order that appears in /metrics output. */
  labelNames?: string[]
}

export interface HistogramOptions extends MetricOptions {
  /** Upper bucket bounds in ascending order. `+Inf` is appended automatically. */
  buckets: number[]
}

export interface Sample {
  labels: LabelSet
  value: number
  /** Optional UNIX millisecond timestamp — emitted as milliseconds per the text format. */
  timestamp?: number
}

export interface HistogramSample extends Sample {
  /** Bucket counts keyed by upper bound ("+Inf" for the overflow bucket). */
  buckets: Record<string, number>
  sum: number
  count: number
}

export interface MetricFamily {
  name: string
  help: string
  type: MetricType
  samples: Sample[]
  /** Only used for histograms — carries bucket + sum + count data. */
  histogramSamples?: HistogramSample[]
}

export interface ScrapeResult {
  text: string
  /** Number of emitted metric families (not individual samples). */
  familyCount: number
  /** Total byte length of the produced text (after encoding to UTF-8). */
  byteSize: number
  truncated: boolean
}

export interface ScrapeOptions {
  /** Hard cap on response bytes. Defaults to 10 MB. */
  maxBytes?: number
}

export interface PrometheusExporterConfig {
  /** When false, /metrics is registered but returns 503 until enabled. */
  enabled?: boolean
  /** Optional bearer token required on /metrics requests. */
  bearerToken?: string
  /** IPv4 / IPv6 allowlist. Empty or undefined means no restriction. */
  ipAllowlist?: string[]
  /** Maximum bytes in /metrics response. Defaults to 10 MB. */
  maxResponseBytes?: number
  /** Maximum distinct label sets per metric family. Defaults to 10000. */
  maxCardinalityPerMetric?: number
}

export interface CardinalityWarning {
  metricName: string
  droppedLabel: string
  /** Timestamp of first occurrence. */
  firstSeenAt: number
}
