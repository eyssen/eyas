export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Eyas-Request': '1', // CSRF protection for session cookie auth
  }

  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'include', // send session cookie
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

  if (res.status === 401) {
    // Session expired or not authenticated — redirect to login (unless already there)
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login'
    }
    throw new ApiError(401, 'Unauthorized')
  }

  // No-body success responses (204 No Content / 205 Reset Content) have no JSON
  // to parse — resolve with undefined instead of throwing on the empty body.
  if (res.status === 204 || res.status === 205) {
    return undefined as T
  }

  let data: any
  try {
    data = await res.json()
  } catch {
    throw new ApiError(res.status, `Non-JSON response: ${res.statusText}`)
  }
  if (!res.ok) {
    throw new ApiError(res.status, data.error || data.message || res.statusText)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
