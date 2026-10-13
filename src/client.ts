import { CLI_USER_AGENT } from './version.js';

export type ApiErrorFields = Record<string, string>;

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly requestId: string | null,
    readonly fields: ApiErrorFields | null,
    message: string,
  ) {
    super(requestId ? `${message} (request ${requestId})` : message);
    this.name = 'ApiClientError';
  }
}

type ApiErrorBody = {
  error?: { code?: unknown; message?: unknown; fields?: unknown };
  request_id?: unknown;
};

function errorFields(value: unknown): ApiErrorFields | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields: ApiErrorFields = {};
  for (const [key, item] of Object.entries(value).slice(0, 10)) {
    if (typeof item === 'string') fields[key] = item;
  }
  return Object.keys(fields).length ? fields : null;
}

async function apiError(response: Response): Promise<ApiClientError> {
  const body = await response.json().catch(() => null) as ApiErrorBody | null;
  const code = typeof body?.error?.code === 'string' ? body.error.code : null;
  const requestId = typeof body?.request_id === 'string'
    ? body.request_id
    : response.headers.get('X-Request-Id');
  const message = code === 'cli_upgrade_required'
    ? 'Your AppBarn CLI is too old. Update with npm install --global appbarn-cli@latest'
    : typeof body?.error?.message === 'string' ? body.error.message : `HTTP ${response.status}`;
  return new ApiClientError(response.status, code, requestId, errorFields(body?.error?.fields), message);
}

export async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await apiError(response);
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new ApiClientError(response.status, 'invalid_response', response.headers.get('X-Request-Id'), null, 'API returned a non-JSON response');
  }
  try {
    return await response.json() as T;
  } catch {
    throw new ApiClientError(response.status, 'invalid_response', response.headers.get('X-Request-Id'), null, 'API returned invalid JSON');
  }
}

export function apiExitCode(error: unknown): number {
  if (!(error instanceof ApiClientError)) return 1;
  if ([400, 413, 415, 426].includes(error.status)) return 2;
  if (error.status === 401) return 3;
  if (error.status === 403 || error.status === 404) return 4;
  if (error.status === 409) return 5;
  if (error.status === 429) return 6;
  if (error.status >= 500) return 7;
  return 1;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    headers.set('User-Agent', CLI_USER_AGENT);
    if (init.body !== undefined && !headers.has('Content-Type') && typeof init.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    return responseJson<T>(response);
  }
}

export function requireAutomationToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = env.APPBARN_TOKEN;
  if (!token) throw new Error('APPBARN_TOKEN is required');
  return token;
}
