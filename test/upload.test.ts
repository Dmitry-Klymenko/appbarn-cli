import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadBuild } from '../src/upload';
import { ApiClientError, apiExitCode } from '../src/client';

const TOKEN = 'ab_test-secret-never-print';
const APP = '11111111-1111-4111-8111-111111111111';
const ENVIRONMENT = '22222222-2222-4222-8222-222222222222';
const IDEMPOTENCY = '33333333-3333-4333-8333-333333333333';
const BUILD = '44444444-4444-4444-8444-444444444444';

afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ab-upload-test-'));
  const file = join(directory, 'app.apk');
  await writeFile(file, Buffer.from([1, 2, 3]));
  return { directory, file };
}

describe('F03/F05 CLI upload composition', () => {
  it('reuses one idempotency declaration, refreshes one expired PUT capability and finalises once', async () => {
    const { directory, file } = await fixture();
    try {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url === 'https://api.example.test/builds' && calls.filter(call => call.url === url).length === 1) {
          return new Response(JSON.stringify({
            build_id: BUILD,
            state: 'pending_upload',
            put: { url: 'https://r2.example.test/first', headers: { 'x-amz-meta-ab-sha256': 'sha', 'If-None-Match': '*' } },
          }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === 'https://r2.example.test/first') return new Response(null, { status: 403 });
        if (url === 'https://api.example.test/builds') {
          return new Response(JSON.stringify({
            build_id: BUILD,
            state: 'pending_upload',
            put: { url: 'https://r2.example.test/second', headers: { 'x-amz-meta-ab-sha256': 'sha', 'If-None-Match': '*' } },
          }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === 'https://r2.example.test/second') return new Response(null, { status: 200 });
        if (url === `https://api.example.test/builds/${BUILD}/finalise`) {
          return new Response(JSON.stringify({ build_id: BUILD, state: 'ready' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        throw new Error(`Unexpected URL ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await uploadBuild({
        apiBase: 'https://api.example.test',
        token: TOKEN,
        appId: APP,
        environmentId: ENVIRONMENT,
        file,
        identity: { app_identifier: 'com.example.app', version: '1.0', build_number: '1' },
        provenance: { provider: 'local', repository: null, commit_sha: null, run_id: null, branch: null, tag: null },
        idempotencyKey: IDEMPOTENCY,
      });
      expect(result).toEqual({ build_id: BUILD, state: 'ready' });

      const reserves = calls.filter(call => call.url === 'https://api.example.test/builds');
      expect(reserves).toHaveLength(2);
      const bodies = reserves.map(call => JSON.parse(String(call.init?.body)) as Record<string, unknown>);
      expect(bodies[0]?.idempotency_key).toBe(IDEMPOTENCY);
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[0]?.environment_id).toBe(ENVIRONMENT);
      expect(bodies[0]?.source_build_id).toBeNull();

      for (const reserve of reserves) {
        expect(new Headers(reserve.init?.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
      }
      const puts = calls.filter(call => call.url.startsWith('https://r2.example.test/'));
      expect(puts).toHaveLength(2);
      for (const put of puts) {
        const headers = new Headers(put.init?.headers);
        expect(headers.get('Authorization')).toBeNull();
        expect(headers.get('If-None-Match')).toBe('*');
        expect(headers.get('Content-Length')).toBe('3');
      }
      expect(calls.filter(call => call.url.endsWith('/finalise'))).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not PUT or finalise when idempotent reserve already reports ready', async () => {
    const { directory, file } = await fixture();
    try {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ build_id: BUILD, state: 'ready' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
      vi.stubGlobal('fetch', fetchMock);
      await uploadBuild({
        apiBase: 'https://api.example.test', token: TOKEN, appId: APP, environmentId: ENVIRONMENT, file,
        identity: { app_identifier: 'com.example.app', version: '1.0', build_number: '1' },
        provenance: { provider: 'local', repository: null, commit_sha: null, run_id: null, branch: null, tag: null },
        idempotencyKey: IDEMPOTENCY,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves API failure semantics during reservation', async () => {
    const { directory, file } = await fixture();
    try {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        error: { code: 'quota_exceeded', message: 'Capacity exhausted' }, request_id: 'req-quota',
      }), { status: 429, headers: { 'Content-Type': 'application/json' } })));
      try {
        await uploadBuild({
          apiBase: 'https://api.example.test', token: TOKEN, appId: APP, environmentId: ENVIRONMENT, file,
          identity: { app_identifier: 'com.example.app', version: '1.0', build_number: '1' },
          provenance: { provider: 'local', repository: null, commit_sha: null, run_id: null, branch: null, tag: null },
        });
        throw new Error('Expected upload to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect(apiExitCode(error)).toBe(6);
        expect((error as ApiClientError).code).toBe('quota_exceeded');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
