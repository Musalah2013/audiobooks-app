import { useState, useEffect, useCallback, useRef } from 'react';

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export function apiFileUrl(objectKey: string): string {
  return `${API_BASE}/api/files/${objectKey}`;
}

// Structured error thrown by all API helpers — carries a short user-facing
// message and optional detail text (server "details" / "guidance" fields).
export class ApiError extends Error {
  detail: string | undefined;
  status: number | undefined;
  constructor(message: string, detail?: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.detail = detail;
    this.status = status;
  }
}

function parseApiError(body: { error?: string; details?: string; guidance?: string }, fallback: string): ApiError {
  const message = body.error || fallback;
  const detail = body.guidance
    ? `Guidance: ${body.guidance}`
    : body.details
      ? `Details: ${body.details}`
      : undefined;
  return new ApiError(message, detail);
}

export async function downloadFile(objectKey: string, fallbackName?: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  const response = await fetch(apiFileUrl(objectKey), {
    method: 'GET',
    cache: 'no-store',
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const err = await response.json() as { error?: string };
      message = err.error || message;
    } catch {
      const text = await response.text().catch(() => '');
      if (text) message = text;
    }
    throw new ApiError(message, undefined, response.status);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i) ?? disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : (fallbackName || objectKey.split('/').pop() || 'download');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Override the default 15s request timeout (ms). Use for long server-side
   *  work like cold-starting the processing container during track prep. */
  timeoutMs?: number;
}

export function useApi<T>(endpoint: string, options?: FetchOptions) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoaded = useRef(false);

  const refetch = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const fetchData = async () => {
      try {
        if (!hasLoaded.current) setLoading(true);
        const response = await fetch(`${API_BASE}${endpoint}`, {
          method: options?.method || 'GET',
          cache: 'no-store',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
          body: options?.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        if (!response.ok) {
          let apiErr: ApiError;
          try {
            const body = await response.json() as { error?: string; details?: string; guidance?: string };
            apiErr = parseApiError(body, `HTTP ${response.status}`);
            apiErr.status = response.status;
          } catch {
            const text = await response.text().catch(() => '');
            apiErr = new ApiError(text || `HTTP ${response.status}`, undefined, response.status);
          }
          throw apiErr;
        }

        const result = await response.json() as T;
        hasLoaded.current = true;
        setData(result);
        setError(null);
        setErrorDetail(null);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
          setErrorDetail(err.detail ?? null);
        } else {
          setError(err instanceof Error ? err.message : 'Unknown error');
          setErrorDetail(null);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    return () => controller.abort();
  }, [endpoint, refreshKey]);

  return { data, loading, error, errorDetail, refetch };
}

export async function apiRequest<T>(endpoint: string, options?: FetchOptions): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options?.timeoutMs ?? 15_000);
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: options?.method || 'GET',
    cache: 'no-store',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  if (!response.ok) {
    let apiErr: ApiError;
    try {
      const body = await response.json() as { error?: string; details?: string; guidance?: string };
      apiErr = parseApiError(body, `HTTP ${response.status}`);
      apiErr.status = response.status;
    } catch {
      const text = await response.text().catch(() => '');
      apiErr = new ApiError(text || `HTTP ${response.status}`, undefined, response.status);
    }
    throw apiErr;
  }

  return response.json();
}
