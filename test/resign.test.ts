import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateResignOptions } from '../src/resign';
import { assertSecretsAbsentFromArgs, childEnvironment, localPath, runTool } from '../src/resign/process';

describe('F09 local signing boundary', () => {
  it('rejects all URL-scheme credential inputs', () => {
    expect(() => localPath('https://example.com/key.p12', 'key')).toThrow(/local filesystem path/u);
    expect(() => localPath('https:key.p12', 'key')).toThrow(/local filesystem path/u);
    expect(() => localPath('file:///tmp/key.p12', 'key')).toThrow(/local filesystem path/u);
    expect(() => localPath('data:application/octet-stream;base64,AA==', 'key')).toThrow(/local filesystem path/u);
  });

  it('does not reject Windows drive syntax as a URL', () => {
    expect(() => localPath('C:\\keys\\release.jks', 'keystore')).not.toThrow();
    expect(() => localPath('C:/keys/release.jks', 'keystore')).not.toThrow();
  });

  it('strips AppBarn bearer credentials and unrelated environment', () => {
    const env = childEnvironment({
      PATH: '/bin',
      HOME: '/home/test',
      APPBARN_TOKEN: 'ab_secret',
      OTHER_SECRET: 'secret',
    });
    expect(env.PATH).toBe('/bin');
    expect(env.HOME).toBe('/home/test');
    expect(env.APPBARN_TOKEN).toBeUndefined();
    expect(env.OTHER_SECRET).toBeUndefined();
  });

  it('fails if a known signing secret is placed in argv', () => {
    expect(() => assertSecretsAbsentFromArgs(['--password', 'top-secret'], ['top-secret'])).toThrow(/must not be passed/u);
    expect(() => assertSecretsAbsentFromArgs(['--ks-pass', 'stdin'], ['top-secret'])).not.toThrow();
  });

  it('treats shell metacharacters as ordinary argv and never interpolates them', async () => {
    const marker = '$(echo should-not-run);`echo nope`;&|';
    const result = await runTool(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', marker]);
    expect(result.stdout).toBe(marker);
  });

  it('bounds tool output and redacts known secrets from failures', async () => {
    await expect(runTool(process.execPath, ['-e', "process.stdout.write('x'.repeat(100))"], { maxOutputBytes: 10 }))
      .rejects.toThrow(/output exceeded limit/u);
    try {
      await runTool(process.execPath, ['-e', "console.error(process.env.AB_TEST_SECRET);process.exit(2)"], { secrets: ['top-secret'], env: { AB_TEST_SECRET: 'top-secret' } });
      throw new Error('expected failure');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('[REDACTED]');
      expect(message).not.toContain('top-secret');
    }
  });

  it('rejects ambiguous or cross-platform signing option sets', () => {
    expect(() => validateResignOptions('ipa', { profile: '/tmp/a.mobileprovision', identity: 'Apple Dev', p12: '/tmp/a.p12' })).toThrow(/exactly one/u);
    expect(() => validateResignOptions('ipa', { profile: '/tmp/a.mobileprovision', identity: 'Apple Dev', keystore: '/tmp/a.jks' })).toThrow(/accepts only/u);
    expect(() => validateResignOptions('apk', { keystore: '/tmp/a.jks', alias: 'release', signingPassword: 'secret', profile: '/tmp/a.mobileprovision' })).toThrow(/accepts only/u);
    expect(() => validateResignOptions('aab', { keystore: '/tmp/a.jks', alias: 'release' })).toThrow(/APPBARN_SIGNING_PASSWORD/u);
  });

  it('accepts the exact supported option sets', () => {
    expect(() => validateResignOptions('apk', { keystore: '/tmp/a.jks', alias: 'release', signingPassword: 'secret' })).not.toThrow();
    expect(() => validateResignOptions('aab', { keystore: '/tmp/a.jks', alias: 'release', signingPassword: 'secret', keyPassword: 'key-secret' })).not.toThrow();
    expect(() => validateResignOptions('ipa', { profile: '/tmp/a.mobileprovision', identity: 'Apple Development' })).not.toThrow();
    expect(() => validateResignOptions('ipa', { profile: '/tmp/a.mobileprovision', p12: '/tmp/a.p12', signingPassword: 'secret' })).not.toThrow();
  });

  it('keeps fixed shell:false process execution and fails visibly on keychain cleanup errors', () => {
    const processSource = readFileSync(new URL('../src/resign/process.ts', import.meta.url), 'utf8');
    const resignSource = readFileSync(new URL('../src/resign.ts', import.meta.url), 'utf8');
    expect(processSource).toContain('shell: false');
    expect(processSource).not.toMatch(/\bexec(?:File)?\s*\(/u);
    expect(resignSource).toContain('await imported?.cleanup()');
    expect(resignSource).toContain("throw new AggregateError([asError(failure), asError(cleanupError)]");
    expect(resignSource).not.toContain('APPBARN_TOKEN');
  });
});
