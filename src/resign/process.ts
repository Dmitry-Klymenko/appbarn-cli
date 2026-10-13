import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'JAVA_HOME',
  'ANDROID_HOME',
  'ANDROID_SDK_ROOT',
  'GEM_HOME',
  'GEM_PATH',
  'BUNDLE_PATH',
] as const;

export function localPath(value: string, label: string) {
  const windowsDrive = /^[A-Za-z]:[\\/]/u.test(value);
  const hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value);
  if (!value || /[\u0000-\u001f\u007f]/u.test(value) || (hasScheme && !windowsDrive)) {
    throw new Error(`${label} must be a local filesystem path`);
  }
  return resolve(value);
}

export async function localFile(value: string, label: string) {
  const path = localPath(value, label);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new Error(`${label} must be an existing file`);
  return path;
}

export function childEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string | undefined> = {},
) {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) if (source[key]) env[key] = source[key];
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) env[key] = value;
  delete env.APPBARN_TOKEN;
  return env;
}

function redact(value: string, secrets: readonly string[]) {
  let result = value;
  for (const secret of secrets) if (secret) result = result.split(secret).join('[REDACTED]');
  return result;
}

export function assertSecretsAbsentFromArgs(args: readonly string[], secrets: readonly string[]) {
  for (const secret of secrets) {
    if (secret && args.some(arg => arg.includes(secret))) throw new Error('Signing secret must not be passed in process arguments');
  }
}

export interface ToolOptions {
  input?: string;
  secrets?: string[];
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

export async function runTool(executable: string, args: string[], options: ToolOptions = {}) {
  const secrets = options.secrets ?? [];
  assertSecretsAbsentFromArgs(args, secrets);
  const max = options.maxOutputBytes ?? 65_536;

  return new Promise<{ stdout: string; stderr: string }>((resolveRun, rejectRun) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnvironment(process.env, options.env),
      signal: options.signal,
    });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let overflow = false;

    const collect = (kind: 'stdout' | 'stderr', chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > max) {
        overflow = true;
        child.kill('SIGKILL');
        return;
      }
      if (kind === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.on('error', error => rejectRun(new Error(redact(error.message, secrets))));
    child.on('close', code => {
      if (overflow) return rejectRun(new Error('Signing tool output exceeded limit'));
      const safeStdout = redact(stdout, secrets);
      const safeStderr = redact(stderr, secrets);
      if (code !== 0) return rejectRun(new Error(`${executable} failed (${code ?? 'signal'}): ${safeStderr || safeStdout}`.trim()));
      resolveRun({ stdout: safeStdout, stderr: safeStderr });
    });

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
