// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type {
  Attributes,
  Sampler,
  SamplingResult,
  SpanContext,
  SpanKind,
  TraceId,
} from './types.js'

/**
 * AlwaysOnSampler records and samples every span. Useful in tests and for
 * very-low-volume systems where every trace matters.
 */
export class AlwaysOnSampler implements Sampler {
  readonly description = 'AlwaysOnSampler'
  shouldSample(
    _parent: SpanContext | null,
    _traceId: TraceId,
    _name: string,
    _kind: SpanKind,
    _attributes: Attributes,
  ): SamplingResult {
    return { decision: 'RECORD_AND_SAMPLE' }
  }
}

/**
 * AlwaysOffSampler drops every span. Useful to disable tracing without
 * removing instrumentation.
 */
export class AlwaysOffSampler implements Sampler {
  readonly description = 'AlwaysOffSampler'
  shouldSample(
    _parent: SpanContext | null,
    _traceId: TraceId,
    _name: string,
    _kind: SpanKind,
    _attributes: Attributes,
  ): SamplingResult {
    return { decision: 'DROP' }
  }
}

/**
 * TraceIdRatioSampler makes a deterministic decision based on the trace id.
 * All spans within the same trace get the same decision, which is critical
 * for keeping traces complete.
 *
 * Algorithm: take the first 8 bytes of the trace id as a u64, compare with
 * (ratio * 2^64). Matches OTel Java/Go SDK behaviour for cross-SDK parity.
 */
export class TraceIdRatioSampler implements Sampler {
  readonly description: string
  private readonly upperBound: bigint

  constructor(private readonly ratio: number) {
    if (ratio < 0 || ratio > 1 || Number.isNaN(ratio)) {
      throw new Error(`TraceIdRatioSampler: ratio must be in [0,1], got ${ratio}`)
    }
    this.description = `TraceIdRatioSampler{${ratio}}`
    // 2^64 as bigint
    const maxU64 = 1n << 64n
    // Multiply as floating and then convert — close enough for sampling.
    this.upperBound = BigInt(Math.floor(ratio * Number(maxU64)))
  }

  shouldSample(
    _parent: SpanContext | null,
    traceId: TraceId,
    _name: string,
    _kind: SpanKind,
    _attributes: Attributes,
  ): SamplingResult {
    if (this.ratio <= 0) return { decision: 'DROP' }
    if (this.ratio >= 1) return { decision: 'RECORD_AND_SAMPLE' }
    // First 16 hex chars = first 8 bytes
    const slice = traceId.slice(0, 16)
    const value = BigInt('0x' + slice)
    return value < this.upperBound
      ? { decision: 'RECORD_AND_SAMPLE' }
      : { decision: 'DROP' }
  }
}

/**
 * ParentBasedSampler follows the parent trace's sampling decision if a
 * parent exists, otherwise falls back to the configured root sampler.
 * This is the recommended default: it keeps traces complete across
 * service boundaries.
 */
export class ParentBasedSampler implements Sampler {
  readonly description: string
  constructor(
    private readonly root: Sampler,
    private readonly remoteParentSampled: Sampler = new AlwaysOnSampler(),
    private readonly remoteParentNotSampled: Sampler = new AlwaysOffSampler(),
    private readonly localParentSampled: Sampler = new AlwaysOnSampler(),
    private readonly localParentNotSampled: Sampler = new AlwaysOffSampler(),
  ) {
    this.description = `ParentBased{root=${root.description}}`
  }

  shouldSample(
    parent: SpanContext | null,
    traceId: TraceId,
    name: string,
    kind: SpanKind,
    attributes: Attributes,
  ): SamplingResult {
    if (!parent) {
      return this.root.shouldSample(parent, traceId, name, kind, attributes)
    }
    const sampled = (parent.traceFlags & 0x01) === 0x01
    const s = parent.isRemote
      ? sampled
        ? this.remoteParentSampled
        : this.remoteParentNotSampled
      : sampled
        ? this.localParentSampled
        : this.localParentNotSampled
    return s.shouldSample(parent, traceId, name, kind, attributes)
  }
}

/**
 * Default sampler: sample 10% of root spans, follow parent for the rest.
 */
export function defaultSampler(): Sampler {
  return new ParentBasedSampler(new TraceIdRatioSampler(0.1))
}
