/**
 * E2E test helpers for EYAS API testing.
 * These tests run against a live EYAS server on localhost:3000.
 */

const BASE_URL = process.env.EYAS_TEST_URL ?? 'http://localhost:3100'

export interface TestSession {
  cookie: string
  userId: string
  username: string
}

/** Login and return session cookie for subsequent requests */
export async function login(
  username = process.env.EYAS_TEST_USERNAME ?? 'testadmin',
  // No hardcoded credential in a public repo — the e2e operator sets this to
  // match their test user (export EYAS_TEST_PASSWORD=...).
  password = process.env.EYAS_TEST_PASSWORD ?? '',
): Promise<TestSession> {
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    redirect: 'manual',
  })
  if (!res.ok) throw new Error(`Login failed: ${res.status}`)

  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) throw new Error('No session cookie returned')

  const cookie = setCookie.split(';')[0]
  const body = (await res.json()) as { user: { id: string; username: string } }

  return {
    cookie,
    userId: body.user.id,
    username: body.user.username,
  }
}

/** Make an authenticated GET request */
export async function get(session: TestSession, path: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: session.cookie },
  })
}

/** Common headers for mutation requests (CSRF protection) */
function mutationHeaders(session: TestSession) {
  return {
    Cookie: session.cookie,
    'Content-Type': 'application/json',
    'X-Eyas-Request': '1',
  }
}

/** Make an authenticated POST request */
export async function post(
  session: TestSession,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: mutationHeaders(session),
    body: body ? JSON.stringify(body) : undefined,
  })
}

/** Make an authenticated PUT request */
export async function put(
  session: TestSession,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: mutationHeaders(session),
    body: body ? JSON.stringify(body) : undefined,
  })
}

/** Make an authenticated PATCH request */
export async function patch(
  session: TestSession,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: mutationHeaders(session),
    body: body ? JSON.stringify(body) : undefined,
  })
}

/** Make an authenticated DELETE request */
export async function del(session: TestSession, path: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { Cookie: session.cookie, 'X-Eyas-Request': '1' },
  })
}

/** Parse JSON body and assert status */
export async function expectJson<T = unknown>(
  res: Response,
  expectedStatus = 200,
): Promise<T> {
  if (res.status !== expectedStatus) {
    const text = await res.text()
    throw new Error(`Expected ${expectedStatus}, got ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}
