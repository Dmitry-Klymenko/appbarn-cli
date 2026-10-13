import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type ConfigKey = 'api' | 'app' | 'environment';
export interface CliConfig { api?: string; app?: string; environment?: string }

const PATH = join(homedir(), '.appbarn', 'config.json');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const LEGACY_API_ORIGINS = new Map([
  ['https://app.app-barn.com', 'https://api.app-barn.com'],
  ['https://staging.app.app-barn.com', 'https://staging.api.app-barn.com'],
]);

export function normalizeApiBase(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error('api must not contain credentials, query or fragment');
  if (url.pathname !== '/') throw new Error('api must be an origin without a path');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw new Error('api must use https; http is allowed only for loopback');
  }
  const origin = url.toString().replace(/\/$/, '');
  return LEGACY_API_ORIGINS.get(origin) ?? origin;
}

function validate(key: ConfigKey, value: string) {
  if (key === 'api') return normalizeApiBase(value);
  const normalized = value.toLowerCase();
  if (!UUID_V4.test(normalized)) throw new Error(`${key} must be a UUIDv4`);
  return normalized;
}

export async function loadConfig(): Promise<CliConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(PATH, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error('Invalid AppBarn config');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid AppBarn config');

  const source = parsed as Record<string, unknown>;
  const allowed = new Set<ConfigKey>(['api', 'app', 'environment']);
  // `project` was accepted by early CLI versions but was never used by an API
  // command. Accept it only while reading so existing configs migrate safely.
  if (Object.keys(source).some(key => !allowed.has(key as ConfigKey) && key !== 'project')) throw new Error('Invalid AppBarn config');

  const result: CliConfig = {};
  for (const key of allowed) {
    const value = source[key];
    if (value !== undefined) {
      if (typeof value !== 'string') throw new Error('Invalid AppBarn config');
      result[key] = validate(key, value);
    }
  }
  return result;
}

export async function setConfig(key: ConfigKey, value: string) {
  const config = await loadConfig();
  config[key] = validate(key, value);
  await mkdir(dirname(PATH), { recursive: true, mode: 0o700 });
  await chmod(dirname(PATH), 0o700);
  await writeFile(PATH, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(PATH, 0o600);
  return config;
}
