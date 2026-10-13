import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectArtifact } from '../src/artifact';

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))));

function zip(entries: Array<[string, string]>) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const n = Buffer.from(name);
    const data = Buffer.from(value);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    locals.push(local, n, data);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(n.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, n);
    offset += local.length + n.length + data.length;
  }

  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, eocd]);
}

const info = (id: string) => `<?xml version="1.0"?><plist><dict>
<key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundleShortVersionString</key><string>1.2.3</string>
<key>CFBundleVersion</key><string>42</string>
</dict></plist>`;
const profile = (expiry = '2099-01-01T00:00:00Z', device = true) => `<?xml version="1.0"?><plist><dict>
<key>ExpirationDate</key><date>${expiry}</date>
${device ? '<key>ProvisionedDevices</key><array><string>device</string></array>' : ''}
</dict></plist>`;
const fallback = { app_identifier: 'com.example.fallback', version: '9.0', build_number: '99' };

async function file(name: string, bytes: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'appbarn-'));
  dirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

async function inspect(entries: Array<[string, string]>) {
  return inspectArtifact(await file('app.ipa', zip(entries)), fallback);
}

function expectUnknown(artifact: Awaited<ReturnType<typeof inspectArtifact>>) {
  expect(artifact).toMatchObject({ ...fallback, installability: 'unknown', ios_profile_expires_at: null });
}

describe('F03 artifact inspection', () => {
  it('classifies APK/AAB deterministically and computes complete-file digests', async () => {
    const apk = await inspectArtifact(await file('app.apk', Buffer.from('apk')), fallback);
    expect(apk).toMatchObject({ artifact_type: 'apk', platform: 'android', installability: 'eligible', size_bytes: 3, ...fallback });
    expect(apk.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(apk.content_md5).toMatch(/^[A-Za-z0-9+/]{22}==$/u);

    const aab = await inspectArtifact(await file('app.aab', Buffer.from('aab')), fallback);
    expect(aab).toMatchObject({ artifact_type: 'aab', platform: 'android', installability: 'ineligible', ...fallback });
  });

  it('rejects zero, unsupported and over-2-GiB artifacts before upload', async () => {
    await expect(inspectArtifact(await file('empty.apk', Buffer.alloc(0)), fallback)).rejects.toThrow(/size/u);
    await expect(inspectArtifact(await file('app.zip', Buffer.from('x')), fallback)).rejects.toThrow(/Unsupported/u);
    const huge = await file('huge.apk', Buffer.from('x'));
    await truncate(huge, 2_147_483_649);
    await expect(inspectArtifact(huge, fallback)).rejects.toThrow(/size/u);
  });

  it('marks a deterministic direct-device IPA eligible only with future profile expiry', async () => {
    const artifact = await inspect([
      ['Payload/App.app/Info.plist', info('com.example.app')],
      ['Payload/App.app/embedded.mobileprovision', profile()],
    ]);
    expect(artifact).toMatchObject({
      artifact_type: 'ipa', platform: 'ios', app_identifier: 'com.example.app', version: '1.2.3', build_number: '42',
      installability: 'eligible',
    });
    expect(artifact.ios_profile_expires_at).toBeGreaterThan(Date.now());
  });

  it('proves expired/no-device profiles ineligible and unsafe/missing profile unknown', async () => {
    expect((await inspect([
      ['Payload/App.app/Info.plist', info('com.example.app')],
      ['Payload/App.app/embedded.mobileprovision', profile('2000-01-01T00:00:00Z')],
    ])).installability).toBe('ineligible');
    expect((await inspect([
      ['Payload/App.app/Info.plist', info('com.example.app')],
      ['Payload/App.app/embedded.mobileprovision', profile('2099-01-01T00:00:00Z', false)],
    ])).installability).toBe('ineligible');
    expect(await inspect([['Payload/App.app/Info.plist', info('com.example.app')]])).toMatchObject({
      app_identifier: 'com.example.app', version: '1.2.3', build_number: '42', installability: 'unknown',
    });
    expect(await inspect([
      ['Payload/App.app/Info.plist', info('com.example.app')],
      ['Payload/App.app/embedded.mobileprovision', 'not a plist'],
    ])).toMatchObject({ app_identifier: 'com.example.app', installability: 'unknown' });
  });

  it('keeps readable IPA identity when the provisioning profile is unavailable', async () => {
    const artifact = await inspectArtifact(await file('app.ipa', zip([
      ['Payload/App.app/Info.plist', info('com.example.app')],
      ['Payload/App.app/embedded.mobileprovision', 'not a plist'],
    ])));
    expect(artifact).toMatchObject({
      app_identifier: 'com.example.app', version: '1.2.3', build_number: '42', installability: 'unknown',
    });
  });

  it('fails closed when primary app metadata is ambiguous', async () => {
    expectUnknown(await inspect([
      ['Payload/One.app/Info.plist', info('com.example.one')],
      ['Payload/Two.app/Info.plist', info('com.example.two')],
      ['Payload/One.app/embedded.mobileprovision', profile()],
      ['Payload/Two.app/embedded.mobileprovision', profile()],
    ]));
  });

  it('fails closed on duplicate primary metadata paths', async () => {
    expectUnknown(await inspect([
      ['Payload/App.app/Info.plist', info('com.example.first')],
      ['Payload/App.app/Info.plist', info('com.example.second')],
      ['Payload/App.app/embedded.mobileprovision', profile()],
    ]));
  });

  it('rejects duplicate ambiguity before accepting an oversized duplicate entry', async () => {
    expectUnknown(await inspect([
      ['Payload/App.app/Info.plist', info('com.example.first')],
      ['Payload/App.app/Info.plist', 'x'.repeat(4_194_305)],
      ['Payload/App.app/embedded.mobileprovision', profile()],
    ]));
  });
});
