// Same origin as the API (Vite proxy locally, Caddy in prod), so the session cookie is sent without any CORS setup.
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string, // set for cases the UI handles specially, e.g. 'delivery_unknown'
  ) {
    super(message);
  }
}

type Issue = { path: (string | number)[]; message: string };

export async function api<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.json === undefined ? 'GET' : 'POST'),
    headers: init.json === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Validation errors name the first bad field, e.g. "leads.3: Invalid email address".
    const issue: Issue | undefined = data?.issues?.[0];
    const message = issue ? `${issue.path.join('.')}: ${issue.message}` : (data?.error ?? `Request failed (${res.status})`);
    throw new ApiError(res.status, message, data?.code);
  }
  return data as T;
}
