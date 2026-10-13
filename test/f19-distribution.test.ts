import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, apiExitCode, ApiClientError } from '../src/client';
import { CLI_USER_AGENT, CLI_VERSION } from '../src/version';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe('F19 CLI distribution contract', () => {
  it('uses one stable version for offline version output and API user agent', () => {
    expect(CLI_VERSION).toBe('0.2.3');
    expect(CLI_USER_AGENT).toBe('appbarn/0.2.3');
  });

  it('uses a publishable executable path without npm manifest correction', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { bin: Record<string, string> };
    expect(manifest.bin).toEqual({ appbarn: 'dist/src/index.js' });
  });

  it('sends the deterministic CLI User-Agent on API client requests', async () => {
    let userAgent: string | null = null;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      userAgent = new Headers(init?.headers).get('User-Agent');
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    await new ApiClient('https://api.app-barn.com', 'ab_test').request('/test');
    expect(userAgent).toBe(CLI_USER_AGENT);
  });

  it('keeps 426 in the existing actionable-input exit category', () => {
    expect(apiExitCode(new ApiClientError(426, 'cli_upgrade_required', 'r1', { minimum_version: '0.2.0' }, 'Upgrade'))).toBe(2);
  });
});
