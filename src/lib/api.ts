// In-memory auth token store (never stored in localStorage per security guidelines)
let authTokenMemory: string | null = null;

export function setAuthToken(token: string | null) {
  authTokenMemory = token;
}

export function getAuthToken(): string | null {
  return authTokenMemory;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (authTokenMemory) {
    headers.set('Authorization', `Bearer ${authTokenMemory}`);
  }
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // ignore non-json error body
    }
    throw new ApiError(message, res.status);
  }

  return (await res.json()) as T;
}

export async function downloadSourceZip(): Promise<void> {
  const headers = new Headers();
  if (authTokenMemory) {
    headers.set('Authorization', `Bearer ${authTokenMemory}`);
  }
  const res = await fetch('/api/export/source-zip', { headers });
  if (!res.ok) {
    throw new Error('Failed to export source ZIP.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'resolveiq-source.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
