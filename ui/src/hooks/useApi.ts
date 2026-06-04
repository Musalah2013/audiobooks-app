import { useState, useEffect, useCallback, useRef } from 'react';

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export function apiFileUrl(objectKey: string): string {
  return `${API_BASE}/api/files/${objectKey}`;
}

export async function downloadFile(objectKey: string, fallbackName?: string) {
  const response = await fetch(apiFileUrl(objectKey), {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const err = await response.json() as { error?: string };
      message = err.error || message;
    } catch {
      const text = await response.text().catch(() => '');
      if (text) message = text;
    }
    throw new Error(message);
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
}

export function useApi<T>(endpoint: string, options?: FetchOptions) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoaded = useRef(false);

  const refetch = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (!hasLoaded.current) setLoading(true);
        const response = await fetch(`${API_BASE}${endpoint}`, {
          method: options?.method || 'GET',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
          body: options?.body ? JSON.stringify(options.body) : undefined,
        });

        if (!response.ok) {
          let message = `HTTP ${response.status}`;
          try {
          const err = await response.json() as { error?: string; details?: string; guidance?: string };
          if (err.guidance) {
            message = `${err.error || message}\n\nGuidance: ${err.guidance}`;
          } else {
            message = err.details ? `${err.error}\n\nDetails: ${err.details}` : (err.error || message);
          }
          } catch {
            const text = await response.text().catch(() => '');
            if (text) message = text;
          }
          throw new Error(message);
        }

        const result = await response.json() as T;
        hasLoaded.current = true;
        setData(result);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [endpoint, refreshKey]);

  return { data, loading, error, refetch };
}

export async function apiRequest<T>(endpoint: string, options?: FetchOptions): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: options?.method || 'GET',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const err = await response.json() as { error?: string; details?: string; guidance?: string };
      if (err.guidance) {
        message = `${err.error || message}\n\nGuidance: ${err.guidance}`;
      } else {
        message = err.details ? `${err.error}\n\nDetails: ${err.details}` : (err.error || message);
      }
    } catch {
      const text = await response.text().catch(() => '');
      if (text) message = text;
    }
    throw new Error(message);
  }

  return response.json();
}
