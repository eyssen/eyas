import { useState, useEffect, useCallback } from 'react'
import { api, ApiError } from '@/lib/api'

interface UseApiResult<T> {
  data: T | null
  error: ApiError | null
  isLoading: boolean
  refetch: () => void
}

export function useApi<T>(path: string): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [trigger, setTrigger] = useState(0)

  const refetch = useCallback(() => setTrigger((t) => t + 1), [])

  useEffect(() => {
    if (!path) {
      setData(null)
      setIsLoading(false)
      return
    }
    let cancelled = false
    // Drop previous path's payload immediately so consumers never apply
    // conversation A under conversation B's URL while the fetch is in flight.
    setData(null)
    setIsLoading(true)
    api
      .get<T>(path)
      .then((d) => {
        if (!cancelled) {
          setData(d)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e : new ApiError(0, String(e)))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path, trigger])

  return { data, error, isLoading, refetch }
}
