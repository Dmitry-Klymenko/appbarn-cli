import { chmod, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiClient } from './client.js';
import { downloadBuild } from './download.js';
import type { Provenance } from './provenance.js';
import { uploadBuild } from './upload.js';
import { localFile, runTool } from './resign/process.js';

type ArtifactType = 'ipa' | 'apk' | 'aab';
type SourceBuild = {
  id: string;
  app_id: string;
  environment_id: string;
  state: string;
  artifact_type: ArtifactType;
  filename: string;
  app_identifier: string;
  version: string;
  build_number: string;
};

export interface ResignOptions {
  apiBase: string;
  token: string;
  buildId: string;
  provenance: Provenance;
  keystore?: string;
  alias?: string;
  profile?: string;
  identity?: string;
  p12?: string;
  signingPassword?: string;
  keyPassword?: string;
}

function requireValue(value: string | undefined, message: string) {
  if (!value) throw new Error(message);
  return value;
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error('Unknown signing failure');
}

export function validateResignOptions(
  type: ArtifactType,
  options: Pick<ResignOptions, 'keystore'|'alias'|'profile'|'identity'|'p12'|'signingPassword'|'keyPassword'>,
) {
  if (type === 'ipa') {
    if (options.keystore || options.alias || options.keyPassword) {
      throw new Error('IPA re-sign accepts only --profile with --identity or --p12');
    }
    requireValue(options.profile, 'IPA re-sign requires --profile');
    if (Boolean(options.identity) === Boolean(options.p12)) {
      throw new Error('IPA re-sign requires exactly one of --identity or --p12');
    }
    if (options.p12) {
      requireValue(options.signingPassword, 'APPBARN_SIGNING_PASSWORD is required for --p12');
    }
    return;
  }

  if (options.profile || options.identity || options.p12) {
    throw new Error(`${type.toUpperCase()} re-sign accepts only --keystore and --alias`);
  }
  requireValue(options.keystore, `${type.toUpperCase()} re-sign requires --keystore`);
  requireValue(options.alias, `${type.toUpperCase()} re-sign requires --alias`);
  requireValue(options.signingPassword, 'APPBARN_SIGNING_PASSWORD is required');
}

async function signApk(source: string, output: string, options: ResignOptions, signal: AbortSignal) {
  const keystore = await localFile(requireValue(options.keystore, 'APK re-sign requires --keystore'), 'keystore');
  const alias = requireValue(options.alias, 'APK re-sign requires --alias');
  const storePassword = requireValue(options.signingPassword, 'APPBARN_SIGNING_PASSWORD is required');
  const keyPassword = options.keyPassword;
  const args = ['sign', '--ks', keystore, '--ks-key-alias', alias, '--ks-pass', 'stdin'];
  let input = `${storePassword}\n`;
  const secrets = [storePassword];
  if (keyPassword) {
    args.push('--key-pass', 'stdin');
    input += `${keyPassword}\n`;
    secrets.push(keyPassword);
  }
  args.push('--out', output, source);
  await runTool('apksigner', args, { input, secrets, signal });
  await runTool('apksigner', ['verify', '--verbose', '--print-certs', output], { signal });
}

async function signAab(source: string, output: string, options: ResignOptions, signal: AbortSignal) {
  const keystore = await localFile(requireValue(options.keystore, 'AAB re-sign requires --keystore'), 'keystore');
  const alias = requireValue(options.alias, 'AAB re-sign requires --alias');
  const storePassword = requireValue(options.signingPassword, 'APPBARN_SIGNING_PASSWORD is required');
  const secrets = [storePassword];
  const env: Record<string, string | undefined> = { AB_STOREPASS: storePassword };
  const args = ['-keystore', keystore, '-storepass:env', 'AB_STOREPASS'];
  if (options.keyPassword) {
    env.AB_KEYPASS = options.keyPassword;
    secrets.push(options.keyPassword);
    args.push('-keypass:env', 'AB_KEYPASS');
  }
  args.push('-signedjar', output, source, alias);
  await runTool('jarsigner', args, { env, secrets, signal });
  await runTool('jarsigner', ['-verify', '-strict', '-certs', output], { signal });
}

function parseKeychains(stdout: string) {
  return stdout.split(/\r?\n/u)
    .map(line => line.trim().replace(/^"|"$/gu, ''))
    .filter(Boolean);
}

async function importP12(
  p12: string,
  password: string,
  directory: string,
  signal: AbortSignal,
) {
  if (process.platform !== 'darwin') throw new Error('IPA .p12 re-sign requires macOS');
  const pem = join(directory, 'identity.pem');
  const keychain = join(directory, 'appbarn-signing.keychain-db');
  const existing = parseKeychains((await runTool('/usr/bin/security', ['list-keychains', '-d', 'user'], { signal })).stdout);
  let listChanged = false;
  let keychainCreated = false;

  async function cleanup() {
    const failures: Error[] = [];
    if (listChanged) {
      try {
        await runTool('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...existing]);
      } catch (error) {
        failures.push(asError(error));
      }
    }
    if (keychainCreated) {
      try {
        await runTool('/usr/bin/security', ['delete-keychain', keychain]);
      } catch (error) {
        failures.push(asError(error));
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Temporary keychain cleanup failed');
  }

  try {
    await runTool('openssl', ['pkcs12', '-in', p12, '-nodes', '-out', pem, '-passin', 'stdin'], {
      input: `${password}\n`,
      secrets: [password],
      signal,
    });
    await chmod(pem, 0o600);
    await runTool('/usr/bin/security', ['create-keychain', '-p', '', keychain], { signal });
    keychainCreated = true;
    await runTool('/usr/bin/security', ['set-keychain-settings', '-lut', '21600', keychain], { signal });
    await runTool('/usr/bin/security', ['unlock-keychain', '-p', '', keychain], { signal });
    await runTool('/usr/bin/security', ['import', pem, '-k', keychain, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security'], { signal });
    await runTool('/usr/bin/security', ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', '', keychain], { signal });
    await runTool('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', keychain, ...existing], { signal });
    listChanged = true;
    const identities = await runTool('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning', keychain], { signal });
    const identity = identities.stdout.match(/\b[0-9A-Fa-f]{40}\b/u)?.[0];
    if (!identity) throw new Error('No code-signing identity found in .p12');
    return { identity, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([asError(error), asError(cleanupError)], 'PKCS#12 import and cleanup failed');
    }
    throw error;
  }
}

async function signIpa(
  source: string,
  output: string,
  options: ResignOptions,
  directory: string,
  signal: AbortSignal,
) {
  if (process.platform !== 'darwin') throw new Error('IPA re-sign requires macOS');
  const profile = await localFile(requireValue(options.profile, 'IPA re-sign requires --profile'), 'provisioning profile');
  let identity = options.identity;
  let imported: Awaited<ReturnType<typeof importP12>> | null = null;
  let failure: unknown = null;

  try {
    if (options.p12) {
      const p12 = await localFile(options.p12, '.p12');
      const password = requireValue(options.signingPassword, 'APPBARN_SIGNING_PASSWORD is required for --p12');
      imported = await importP12(p12, password, directory, signal);
      identity = imported.identity;
    }
    await copyFile(source, output);
    await chmod(output, 0o600);
    await runTool('fastlane', [
      'run',
      'resign',
      `ipa:${output}`,
      `signing_identity:${requireValue(identity, 'Signing identity unavailable')}`,
      `provisioning_profile:${profile}`,
    ], { signal });
    await runTool('/usr/bin/unzip', ['-tq', output], { signal, maxOutputBytes: 262_144 });
  } catch (error) {
    failure = error;
  }

  try {
    await imported?.cleanup();
  } catch (cleanupError) {
    if (failure) {
      throw new AggregateError([asError(failure), asError(cleanupError)], 'IPA signing and cleanup failed');
    }
    throw cleanupError;
  }
  if (failure) throw failure;
}

export async function resignBuild(options: ResignOptions) {
  const client = new ApiClient(options.apiBase, options.token);
  const source = await client.request<SourceBuild>(`/builds/${encodeURIComponent(options.buildId)}`);
  if (source.state !== 'ready') throw new Error('Source Build is not ready');
  validateResignOptions(source.artifact_type, options);

  const directory = await mkdtemp(join(tmpdir(), 'appbarn-resign-'));
  await chmod(directory, 0o700);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  try {
    const sourcePath = join(directory, `source.${source.artifact_type}`);
    const outputPath = join(directory, `signed.${source.artifact_type}`);
    await downloadBuild({
      apiBase: options.apiBase,
      token: options.token,
      buildId: source.id,
      output: sourcePath,
    });
    if (controller.signal.aborted) throw new Error('Re-sign interrupted');

    if (source.artifact_type === 'apk') await signApk(sourcePath, outputPath, options, controller.signal);
    else if (source.artifact_type === 'aab') await signAab(sourcePath, outputPath, options, controller.signal);
    else await signIpa(sourcePath, outputPath, options, directory, controller.signal);
    if (controller.signal.aborted) throw new Error('Re-sign interrupted');

    await chmod(outputPath, 0o600);
    return await uploadBuild({
      apiBase: options.apiBase,
      token: options.token,
      appId: source.app_id,
      environmentId: source.environment_id,
      file: outputPath,
      identity: {
        app_identifier: source.app_identifier,
        version: source.version,
        build_number: source.build_number,
      },
      provenance: options.provenance,
      sourceBuildId: source.id,
    });
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await rm(directory, { recursive: true, force: true });
  }
}
