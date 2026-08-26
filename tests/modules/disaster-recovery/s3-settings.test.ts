import { describe, it, expect } from 'vitest'
import { normalizeS3Settings } from '@modules/disaster-recovery/destinations/s3.js'

describe('normalizeS3Settings', () => {
  it('adds https:// when the scheme is missing', () => {
    const out = normalizeS3Settings({
      endpoint: 's3.eu-central-003.backblazeb2.com',
    })
    expect(out.endpoint).toBe('https://s3.eu-central-003.backblazeb2.com')
  })

  it('infers Backblaze region from the hostname', () => {
    const out = normalizeS3Settings({
      endpoint: 's3.eu-central-003.backblazeb2.com',
    })
    expect(out.region).toBe('eu-central-003')
  })

  it('keeps an explicit region', () => {
    const out = normalizeS3Settings({
      endpoint: 'https://s3.eu-central-003.backblazeb2.com',
      region: 'us-west-000',
    })
    expect(out.endpoint).toBe('https://s3.eu-central-003.backblazeb2.com')
    expect(out.region).toBe('us-west-000')
  })

  it('defaults non-B2 endpoints to auto', () => {
    const out = normalizeS3Settings({ endpoint: 'https://s3.amazonaws.com' })
    expect(out.region).toBe('auto')
  })
})
