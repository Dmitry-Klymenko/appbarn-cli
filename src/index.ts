#!/usr/bin/env node
import { ApiClient, ApiClientError, apiExitCode, requireAutomationToken } from './client.js';
import { loadConfig, setConfig, type ConfigKey } from './config.js';
import { downloadBuild } from './download.js';
import { detectProvenance } from './provenance.js';
import { resignBuild } from './resign.js';
import { uploadBuild } from './upload.js';
import { CLI_VERSION } from './version.js';

const USAGE = `Usage:
  appbarn --help
  appbarn --version
  appbarn config show
  appbarn config set <api|app|environment> <value>
  appbarn upload <file> [--app <uuid>] [--environment <uuid>] [--app-identifier <id>] [--version <value>] [--build-number <value>]
  appbarn builds list [--app <uuid>] [--environment <uuid>] [--version <value>] [--build <value>] [--platform <ios|android>] [--commit <sha>] [--cursor <cursor>]
  appbarn builds download <build-uuid> [--output <path>] [--force]
  appbarn resign <build-uuid> --keystore <path> --alias <alias>
  appbarn resign <build-uuid> --profile <path> --identity <codesign-identity>
  appbarn resign <build-uuid> --profile <path> --p12 <path>

Signing passwords are read only from APPBARN_SIGNING_PASSWORD and optional APPBARN_KEY_PASSWORD
`;

type ParsedOptions = { positionals: string[]; values: Record<string, string>; flags: Set<string> };

function parseOptions(args: string[], valueOptions: readonly string[], flagOptions: readonly string[] = []): ParsedOptions {
  const values = new Set(valueOptions);
  const flags = new Set(flagOptions);
  const result: ParsedOptions = { positionals: [], values: {}, flags: new Set() };
  let positionalOnly = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (positionalOnly || !arg.startsWith('-') || arg === '-') { result.positionals.push(arg); continue; }
    if (arg === '--') { positionalOnly = true; continue; }
    if (!arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    const separator = arg.indexOf('=');
    const name = separator < 0 ? arg : arg.slice(0, separator);
    const inlineValue = separator < 0 ? undefined : arg.slice(separator + 1);
    if (flags.has(name)) {
      if (inlineValue !== undefined) throw new Error(`${name} does not take a value`);
      if (result.flags.has(name)) throw new Error(`${name} may be used only once`);
      result.flags.add(name);
      continue;
    }
    if (!values.has(name)) throw new Error(`Unknown option ${name}`);
    if (Object.hasOwn(result.values, name)) throw new Error(`${name} may be used only once`);
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    result.values[name] = value;
  }
  return result;
}

function onlyPosition(parsed: ParsedOptions, label: string) {
  if (parsed.positionals.length !== 1) throw new Error(`${label} requires exactly one value`);
  return parsed.positionals[0]!;
}

function uuid(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new Error(`${label} must be a UUIDv4`);
  return value.toLowerCase();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command, subcommand] = args;
  if (!command || args.includes('--help') || args.includes('-h') || command === 'help') { process.stdout.write(USAGE); return; }
  if (command === '--version' || command === '-v') {
    if (args.length !== 1) throw new Error(USAGE);
    process.stdout.write(`${CLI_VERSION}\n`);
    return;
  }
  if (command === 'config' && subcommand === 'show') {
    if (args.length !== 2) throw new Error(USAGE);
    process.stdout.write(`${JSON.stringify(await loadConfig(), null, 2)}\n`);
    return;
  }
  if (command === 'config' && subcommand === 'set') {
    const key = args[2] as ConfigKey | undefined;
    const value = args[3];
    if (!key || !['api', 'app', 'environment'].includes(key) || !value || args.length !== 4) throw new Error(USAGE);
    await setConfig(key, value);
    process.stdout.write(`${key} updated\n`);
    return;
  }

  const config = await loadConfig();
  if (!config.api) throw new Error('Configure api first');
  const api = config.api;
  const token = requireAutomationToken();
  if (command === 'upload') {
    const parsed = parseOptions(args.slice(1), ['--app', '--environment', '--app-identifier', '--version', '--build-number']);
    const app = parsed.values['--app'] ?? config.app;
    const environment = parsed.values['--environment'] ?? config.environment;
    if (!app || !environment) throw new Error('upload requires app and environment');
    const result = await uploadBuild({
      apiBase: api, token, appId: uuid(app, 'app'), environmentId: uuid(environment, 'environment'), file: onlyPosition(parsed, 'upload'),
      identity: {
        ...(parsed.values['--app-identifier'] !== undefined ? { app_identifier: parsed.values['--app-identifier'] } : {}),
        ...(parsed.values['--version'] !== undefined ? { version: parsed.values['--version'] } : {}),
        ...(parsed.values['--build-number'] !== undefined ? { build_number: parsed.values['--build-number'] } : {}),
      }, provenance: detectProvenance(),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === 'builds' && subcommand === 'list') {
    const parsed = parseOptions(args.slice(2), ['--app', '--environment', '--version', '--build', '--platform', '--commit', '--cursor']);
    if (parsed.positionals.length) throw new Error('builds list does not accept positional values');
    const app = parsed.values['--app'] ?? config.app;
    if (!app) throw new Error('builds list requires app');
    const parameters = new URLSearchParams();
    const environment = parsed.values['--environment'];
    if (environment) parameters.set('environment', uuid(environment, 'environment'));
    for (const name of ['--version', '--build', '--platform', '--commit', '--cursor'] as const) {
      const value = parsed.values[name]; if (value) parameters.set(name.slice(2), value);
    }
    if (parameters.get('platform') && !['ios', 'android'].includes(parameters.get('platform')!)) throw new Error('platform must be ios or android');
    if (parameters.get('commit') && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(parameters.get('commit')!)) throw new Error('commit must be a full SHA-1 or SHA-256');
    const query = parameters.size ? `?${parameters}` : '';
    const result = await new ApiClient(api, token).request(`/apps/${encodeURIComponent(uuid(app, 'app'))}/builds${query}`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === 'builds' && subcommand === 'download') {
    const parsed = parseOptions(args.slice(2), ['--output'], ['--force']);
    const result = await downloadBuild({
      apiBase: api, token, buildId: uuid(onlyPosition(parsed, 'builds download'), 'build id'),
      ...(parsed.values['--output'] !== undefined ? { output: parsed.values['--output'] } : {}), force: parsed.flags.has('--force'),
    });
    process.stdout.write(`${result.path}\n`);
    return;
  }
  if (command === 'resign') {
    const parsed = parseOptions(args.slice(1), ['--keystore', '--alias', '--profile', '--identity', '--p12']);
    const signingPassword = process.env.APPBARN_SIGNING_PASSWORD;
    const keyPassword = process.env.APPBARN_KEY_PASSWORD;
    const result = await resignBuild({
      apiBase: api, token, buildId: uuid(onlyPosition(parsed, 'resign'), 'build id'), provenance: detectProvenance(),
      ...(parsed.values['--keystore'] !== undefined ? { keystore: parsed.values['--keystore'] } : {}),
      ...(parsed.values['--alias'] !== undefined ? { alias: parsed.values['--alias'] } : {}),
      ...(parsed.values['--profile'] !== undefined ? { profile: parsed.values['--profile'] } : {}),
      ...(parsed.values['--identity'] !== undefined ? { identity: parsed.values['--identity'] } : {}),
      ...(parsed.values['--p12'] !== undefined ? { p12: parsed.values['--p12'] } : {}),
      ...(signingPassword !== undefined ? { signingPassword } : {}), ...(keyPassword !== undefined ? { keyPassword } : {}),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error(USAGE);
}

main().catch(error => {
  const code = error instanceof ApiClientError ? error.code : null;
  process.stderr.write(`${code ? `[${code}] ` : ''}${error instanceof Error ? error.message : 'Command failed'}\n`);
  process.exitCode = apiExitCode(error);
});
