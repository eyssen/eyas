// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// ONE place decides whether a provider error is an auth failure (so the reauth
// healer should reload credentials) versus a transient rate-limit/overload (so
// it should back off, NOT reload). Getting 429/529 wrong would hammer reload on
// every overload spike. Single source of truth — Cap 2 + Cap 3 consume it too.

import { describe, it, expect } from 'vitest'
import { classifyAuthError } from '@shared/classify-auth-error.js'

describe('classifyAuthError', () => {
  it('treats 401 and 403 as auth failures', () => {
    expect(classifyAuthError(401)).toMatchObject({ kind: 'auth', isAuth: true })
    expect(classifyAuthError(403)).toMatchObject({ kind: 'auth', isAuth: true })
  })

  it('treats 429 as rate-limit, NOT auth', () => {
    expect(classifyAuthError(429)).toMatchObject({ kind: 'rate-limit', isAuth: false })
  })

  it('treats 529 (overloaded) as overload, NOT auth', () => {
    expect(classifyAuthError(529)).toMatchObject({ kind: 'overload', isAuth: false })
  })

  it('treats other statuses as other', () => {
    expect(classifyAuthError(500)).toMatchObject({ kind: 'other', isAuth: false })
    expect(classifyAuthError(200)).toMatchObject({ kind: 'other', isAuth: false })
  })

  it('reads a status code off an error object (status / statusCode / response.status)', () => {
    expect(classifyAuthError({ status: 401 }).isAuth).toBe(true)
    expect(classifyAuthError({ statusCode: 403 }).isAuth).toBe(true)
    expect(classifyAuthError({ response: { status: 401 } }).isAuth).toBe(true)
    expect(classifyAuthError({ status: 429 }).kind).toBe('rate-limit')
  })

  it('falls back to message text when no status is present', () => {
    expect(classifyAuthError(new Error('401 Unauthorized')).isAuth).toBe(true)
    expect(classifyAuthError(new Error('invalid api key')).isAuth).toBe(true)
    expect(classifyAuthError(new Error('authentication_error')).isAuth).toBe(true)
    expect(classifyAuthError(new Error('rate_limit_error')).kind).toBe('rate-limit')
    expect(classifyAuthError(new Error('overloaded_error')).kind).toBe('overload')
  })

  it('classifies an unknown error as other (not auth)', () => {
    expect(classifyAuthError(new Error('boom')).isAuth).toBe(false)
    expect(classifyAuthError(undefined).isAuth).toBe(false)
    expect(classifyAuthError(null).kind).toBe('other')
  })
})
