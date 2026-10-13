import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBuild, publishDownloadedFile } from '../src/download';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

async function directory() {
  return mkdtemp(join(tmpdir(), 'appbarn-download-test-'));
}

describe('F08 download final publish', () => {
  it('does not overwrite a file that appears before final publish', async () => {
    const dir = await directory();
    const temp = join(dir, 'artifact.tmp');
    const target = join(dir, 'artifact.apk');
    try {
      await writeFile(temp, 'new');
      await writeFile(target, 'existing');
      await expect(publishDownloadedFile(temp, target, false)).rejects.toThrow(/Refusing to overwrite/u);
      expect(await readFile(target, 'utf8')).toBe('existing');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('publishes without overwrite and removes the temporary name', async () => {
    const dir = await directory();
    const temp = join(dir, 'artifact.tmp');
    const target = join(dir, 'artifact.apk');
    try {
      await writeFile(temp, 'new');
      await publishDownloadedFile(temp, target, false);
      expect(await readFile(target, 'utf8')).toBe('new');
      await expect(readFile(temp)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('replaces only when force is explicit', async () => {
    const dir = await directory();
    const temp = join(dir, 'artifact.tmp');
    const target = join(dir, 'artifact.apk');
    try {
      await writeFile(temp, 'new');
      await writeFile(target, 'existing');
      await publishDownloadedFile(temp, target, true);
      expect(await readFile(target, 'utf8')).toBe('new');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('publishes only bytes that match the Build checksum and size', async () => {
    const dir = await directory();
    const output = join(dir, 'artifact.apk');
    const bytes = Buffer.from('verified artifact');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    try {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === 'https://api.example.test/builds/44444444-4444-4444-8444-444444444444') {
          return new Response(JSON.stringify({ filename: 'artifact.apk', size_bytes: bytes.length, sha256 }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/download-url')) {
          return new Response(JSON.stringify({ url: 'https://storage.example.test/artifact', filename: 'artifact.apk', expires_in: 300 }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (url === 'https://storage.example.test/artifact') return new Response(bytes);
        throw new Error(`Unexpected URL ${url}`);
      });
      await downloadBuild({
        apiBase: 'https://api.example.test', token: 'ab_test', buildId: '44444444-4444-4444-8444-444444444444', output,
      });
      expect(await readFile(output)).toEqual(bytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('removes invalid downloads instead of publishing them', async () => {
    const dir = await directory();
    const output = join(dir, 'artifact.apk');
    try {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === 'https://api.example.test/builds/44444444-4444-4444-8444-444444444444') {
          return new Response(JSON.stringify({ filename: 'artifact.apk', size_bytes: 4, sha256: 'a'.repeat(64) }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/download-url')) {
          return new Response(JSON.stringify({ url: 'https://storage.example.test/artifact', filename: 'artifact.apk', expires_in: 300 }), { headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('wrong');
      });
      await expect(downloadBuild({
        apiBase: 'https://api.example.test', token: 'ab_test', buildId: '44444444-4444-4444-8444-444444444444', output,
      })).rejects.toThrow(/does not match/u);
      await expect(readFile(output)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
