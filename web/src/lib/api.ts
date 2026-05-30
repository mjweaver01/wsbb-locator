/**
 * Single source for the API base URL and a thin JSON fetch helper. In dev the
 * base is empty and Vite proxies `/api/*`; in prod the SPA and API share an
 * origin, so empty also works. Set `VITE_API_URL` only for split deployments.
 */
export const API_BASE = import.meta.env.VITE_API_URL ?? "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

interface ApiErrorBody {
  error?: string;
}

/**
 * Fetch JSON from the API, throwing a useful error on non-2xx. Callers that
 * need bespoke handling (e.g. treating 401 as a state, multipart uploads) should
 * use `fetch` with `apiUrl(...)` directly instead.
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  const data = (await response.json().catch(() => null)) as
    | (T & ApiErrorBody)
    | null;
  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed (${response.status})`);
  }
  return data as T;
}
