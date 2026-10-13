import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const versionSource = await readFile(join(root, 'src/version.ts'), 'utf8');
const fail = message => { throw new Error('CLI verification failed: ' + message); };
if (pkg.name !== 'appbarn-cli' || pkg.license !== 'MIT') fail('package identity and MIT license');
if (pkg.repository?.url !== 'git+https://github.com/Dmitry-Klymenko/appbarn-cli.git') fail('repository metadata');
if (pkg.bin?.appbarn !== 'dist/src/index.js' || pkg.engines?.node !== '>=22') fail('bin and Node engine');
if (versionSource.includes("CLI_VERSION = '" + pkg.version + "'") === false) fail('runtime/package version mismatch');
if (Object.keys(pkg.dependencies ?? {}).length) fail('runtime dependencies must remain empty');
for (const f of ['LICENSE', 'README.md', 'dist/src/index.js']) await readFile(join(root, f));
function run(cmd, args, cwd, env) {
  const p = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120000, env: env ?? process.env });
  if (p.error || p.status !== 0) fail(cmd + ' ' + args.join(' ') + ': ' + (p.error?.message ?? p.stderr));
  return p.stdout.trim();
}
const scratch = await mkdtemp(join(tmpdir(), 'appbarn-cli-verify-'));
let tarball;
try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts'], root));
  const result = packed[0];
  if (!result?.filename) fail('npm pack returned no tarball');
  const names = new Set(result.files.map(f => f.path));
  for (const f of ['dist/src/index.js', 'README.md', 'LICENSE', 'package.json']) if (!names.has(f)) fail('missing packed ' + f);
  if ([...names].some(n => n.startsWith('test/') || n.startsWith('src/') || n.startsWith('.github/') || n.includes('.env'))) fail('private/source/test files in tarball');
  tarball = join(root, result.filename);
  const consumer = join(scratch, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), '{"private":true}\n');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', tarball], consumer);
  const bin = join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'appbarn.cmd' : 'appbarn');
  if (!run(bin, ['--help'], consumer).includes('Usage:')) fail('offline --help');
  if (run(bin, ['--version'], consumer) !== pkg.version) fail('offline --version');
  console.log('Packed CLI ' + pkg.version + ' verified');
} finally {
  if (tarball) await rm(tarball, { force: true });
  await rm(scratch, { recursive: true, force: true });
}
