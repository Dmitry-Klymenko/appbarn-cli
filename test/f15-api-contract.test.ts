import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiClientError, apiExitCode } from '../src/client';

afterEach(() => vi.unstubAllGlobals());

describe('F15 CLI API contract', () => {
  it('preserves stable error code, fields and request ID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'invalid_request', message: 'Invalid request', fields: { name: 'Required' } },
      request_id: 'req-123',
    }), { status: 400, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-123' } })));
    const client = new ApiClient('https://api.app-barn.com', 'ab_test');
    try {
      await client.request('/test');
      throw new Error('Expected request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
      const api = error as ApiClientError;
      expect(api.code).toBe('invalid_request');
      expect(api.requestId).toBe('req-123');
      expect(api.fields).toEqual({ name: 'Required' });
      expect(api.message).toContain('request req-123');
      expect(apiExitCode(api)).toBe(2);
    }
  });

  it('gives an actionable update instruction for an unsupported CLI version', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'cli_upgrade_required', message: 'Upgrade appbarn-cli to continue' }, request_id: 'req-426',
    }), { status: 426, headers: { 'Content-Type': 'application/json' } })));
    await expect(new ApiClient('https://api.app-barn.com', 'ab_test').request('/test'))
      .rejects.toThrow(/npm install --global appbarn-cli@latest/u);
  });

  it('uses stable non-zero categories for auth, conflict, quota and server errors', () => {
    const error = (status: number) => new ApiClientError(status, null, null, null, 'x');
    expect(apiExitCode(error(401))).toBe(3);
    expect(apiExitCode(error(404))).toBe(4);
    expect(apiExitCode(error(409))).toBe(5);
    expect(apiExitCode(error(429))).toBe(6);
    expect(apiExitCode(error(503))).toBe(7);
  });

  it('rejects a successful non-JSON API response instead of guessing its shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain', 'X-Request-Id': 'req-456' } })));
    const client = new ApiClient('https://api.app-barn.com', 'ab_test');
    await expect(client.request('/test')).rejects.toMatchObject({ code: 'invalid_response', requestId: 'req-456' });
  });
});
