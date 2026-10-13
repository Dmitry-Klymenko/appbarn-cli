import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, link, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ApiClient } from './client.js';

export interface DownloadOptions {
  apiBase: string;
  token: string;
  buildId: string;
  output?: string;
  force?: boolean;
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function overwriteError(target: string) {
  return new Error(`Refusing to overwrite ${target}; use --force`);
}

function downloadFilename(value: unknown): string {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || basename(value) !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('API returned an invalid download filename');
  }
  return value;
}

function checksum(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw new Error('API returned an invalid artifact checksum');
  return value;
}

function size(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('API returned an invalid artifact size');
  return value;
}

export async function publishDownloadedFile(temp: string, target: string, force = false) {
  if (force) {
    if (await exists(target)) await rm(target);
    await rename(temp, target);
    return;
  }

  try {
    // temp and target share a parent, so hard-link creation is an atomic no-overwrite publish.
    await link(temp, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw overwriteError(target);
    throw error;
  }
  await rm(temp);
}

export async function downloadBuild(options: DownloadOptions) {
  const client = new ApiClient(options.apiBase, options.token);
  const build = await client.request<{ filename: unknown; size_bytes: unknown; sha256: unknown }>(
    `/builds/${encodeURIComponent(options.buildId)}`,
  );
  const filename = downloadFilename(build.filename);
  const expectedSize = size(build.size_bytes);
  const expectedSha256 = checksum(build.sha256);
  const capability = await client.request<{ url: string; filename: string; expires_in: number }>(
    `/builds/${encodeURIComponent(options.buildId)}/download-url`,
    { method: 'POST' },
  );
  if (capability.filename !== filename) throw new Error('API returned inconsistent download metadata');
  const target = resolve(options.output ?? filename);
  const parent = dirname(target);
  const parentInfo = await stat(parent).catch(() => null);
  if (!parentInfo?.isDirectory()) throw new Error('download output parent must already exist');
  if (!options.force && await exists(target)) throw overwriteError(target);

  const response = await fetch(capability.url);
  if (!response.ok || !response.body) {
    throw new Error(`Artifact download failed: HTTP ${response.status}`);
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && contentLength !== String(expectedSize)) {
    throw new Error('Artifact download size does not match Build metadata');
  }

  const temp = `${target}.ab-${crypto.randomUUID()}.tmp`;
  const hash = createHash('sha256');
  let downloaded = 0;
  const verify = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (downloaded + chunk.length > expectedSize) {
        callback(new Error('Artifact download size does not match Build metadata'));
        return;
      }
      downloaded += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      verify,
      createWriteStream(temp, { flags: 'wx', mode: 0o600 }),
    );
    if (downloaded !== expectedSize || hash.digest('hex') !== expectedSha256) {
      throw new Error('Artifact download does not match Build metadata');
    }
    await publishDownloadedFile(temp, target, Boolean(options.force));
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }

  return { path: target, filename };
}
