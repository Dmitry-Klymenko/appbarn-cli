import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const MAX_ARTIFACT = 2_147_483_648;
const MAX_ENTRIES = 100_000;
const MAX_METADATA = 4_194_304;
const MAX_METADATA_TOTAL = 16_777_216;
const MAX_CENTRAL_DIRECTORY = 67_108_864;

export interface ArtifactIdentity {
  artifact_type: 'ipa' | 'apk' | 'aab';
  platform: 'ios' | 'android';
  filename: string;
  size_bytes: number;
  content_md5: string;
  sha256: string;
  app_identifier: string;
  version: string;
  build_number: string;
  installability: 'eligible' | 'ineligible' | 'unknown';
  ios_profile_expires_at: number | null;
}

export interface IdentityFallback {
  app_identifier?: string;
  version?: string;
  build_number?: string;
}

async function hashes(path: string) {
  const sha256 = createHash('sha256');
  const md5 = createHash('md5');
  for await (const chunk of createReadStream(path)) {
    sha256.update(chunk);
    md5.update(chunk);
  }
  return { sha256: sha256.digest('hex'), content_md5: md5.digest('base64') };
}

function plistValue(xml: string, key: string) {
  return xml.match(new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([^<]{1,500})</string>`))?.[1]?.trim() ?? null;
}

function profile(text: string) {
  const start = text.indexOf('<?xml');
  const end = text.lastIndexOf('</plist>');
  if (start < 0 || end < start) return { installability: 'unknown' as const, expires: null };

  const xml = text.slice(start, end + 8);
  const rawDate = xml.match(/<key>\s*ExpirationDate\s*<\/key>\s*<date>([^<]+)<\/date>/)?.[1];
  const expires = rawDate ? Date.parse(rawDate) : NaN;
  if (!Number.isFinite(expires)) return { installability: 'unknown' as const, expires: null };

  const allDevices = /<key>\s*ProvisionsAllDevices\s*<\/key>\s*<true\s*\/>/.test(xml);
  const provisionedDevices = /<key>\s*ProvisionedDevices\s*<\/key>\s*<array>[\s\S]*?<string>[^<]+<\/string>[\s\S]*?<\/array>/.test(xml);
  return {
    installability: expires <= Date.now() || (!allDevices && !provisionedDevices) ? 'ineligible' as const : 'eligible' as const,
    expires,
  };
}

type ZipEntry = { off: number; compressed: number; plain: number; method: number };

async function metadata(path: string) {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    const tailSize = Math.min(size, 66_000);
    const tail = Buffer.alloc(tailSize);
    await file.read(tail, 0, tailSize, size - tailSize);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Invalid ZIP');

    const count = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (
      count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff ||
      count > MAX_ENTRIES || directorySize > MAX_CENTRAL_DIRECTORY || directoryOffset + directorySize > size
    ) throw new Error('Archive limits exceeded');

    const directory = Buffer.alloc(directorySize);
    await file.read(directory, 0, directorySize, directoryOffset);
    const wanted = new Map<string, ZipEntry>();
    const seen = new Set<string>();
    let offset = 0;
    let declared = 0;

    for (let i = 0; i < count; i++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid central directory');
      const method = directory.readUInt16LE(offset + 10);
      const compressed = directory.readUInt32LE(offset + 20);
      const plain = directory.readUInt32LE(offset + 24);
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const localOffset = directory.readUInt32LE(offset + 42);
      const next = offset + 46 + nameLength + extraLength + commentLength;
      if (next > directory.length) throw new Error('Invalid central directory');

      const name = directory.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
      if (/^Payload\/[^/]+\.app\/(?:Info\.plist|embedded\.mobileprovision)$/.test(name)) {
        if (seen.has(name)) throw new Error('Ambiguous metadata entry');
        seen.add(name);
        if (plain > MAX_METADATA || compressed > MAX_METADATA) throw new Error('Metadata limit exceeded');
        declared += plain;
        if (declared > MAX_METADATA_TOTAL) throw new Error('Metadata limit exceeded');
        wanted.set(name, { off: localOffset, compressed, plain, method });
      }
      offset = next;
    }

    const result = new Map<string, string>();
    let decoded = 0;
    for (const [name, entry] of wanted) {
      const header = Buffer.alloc(30);
      await file.read(header, 0, header.length, entry.off);
      if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid local header');

      const nameLength = header.readUInt16LE(26);
      const extraLength = header.readUInt16LE(28);
      const start = entry.off + 30 + nameLength + extraLength;
      if (start + entry.compressed > size) throw new Error('Invalid ZIP entry');

      const bytes = Buffer.alloc(entry.compressed);
      await file.read(bytes, 0, bytes.length, start);
      const plain = entry.method === 0
        ? bytes
        : entry.method === 8
          ? inflateRawSync(bytes, { maxOutputLength: MAX_METADATA + 1 })
          : null;
      if (!plain || plain.length !== entry.plain || plain.length > MAX_METADATA) throw new Error('Metadata entry invalid');

      decoded += plain.length;
      if (decoded > MAX_METADATA_TOTAL) throw new Error('Metadata limit exceeded');
      result.set(name, plain.toString('utf8'));
    }
    return result;
  } finally {
    await file.close();
  }
}

export async function inspectArtifact(path: string, fallback: IdentityFallback = {}): Promise<ArtifactIdentity> {
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_ARTIFACT) throw new Error('Artifact size invalid');

  const filename = basename(path);
  if (Buffer.byteLength(filename) > 255 || /[\u0000-\u001f\u007f]/u.test(filename)) throw new Error('Artifact filename invalid');

  const ext = extname(filename).slice(1).toLowerCase();
  if (!['ipa', 'apk', 'aab'].includes(ext)) throw new Error('Unsupported artifact');
  const artifact_type = ext as 'ipa' | 'apk' | 'aab';
  const platform = artifact_type === 'ipa' ? 'ios' as const : 'android' as const;

  let app_identifier = fallback.app_identifier ?? null;
  let version = fallback.version ?? null;
  let build_number = fallback.build_number ?? null;
  let installability: ArtifactIdentity['installability'] = artifact_type === 'apk' ? 'eligible' : artifact_type === 'aab' ? 'ineligible' : 'unknown';
  let ios_profile_expires_at: number | null = null;

  if (artifact_type === 'ipa') {
    try {
      const entries = await metadata(path);
      const infos = [...entries.entries()].filter(([name]) => name.endsWith('/Info.plist'));
      if (infos.length === 1) {
        const [name, xml] = infos[0]!;
        app_identifier = plistValue(xml, 'CFBundleIdentifier') ?? app_identifier;
        version = plistValue(xml, 'CFBundleShortVersionString') ?? version;
        build_number = plistValue(xml, 'CFBundleVersion') ?? build_number;
        const rawProfile = entries.get(name.replace(/Info\.plist$/, 'embedded.mobileprovision'));
        if (rawProfile) {
          const parsed = profile(rawProfile);
          installability = parsed.installability;
          ios_profile_expires_at = parsed.expires;
        }
      }
    } catch {
      installability = 'unknown';
      ios_profile_expires_at = null;
    }
  }

  if (!app_identifier || !version || !build_number) {
    throw new Error('Artifact identity unavailable; provide --app-identifier, --version and --build-number');
  }
  return {
    artifact_type,
    platform,
    filename,
    size_bytes: info.size,
    ...await hashes(path),
    app_identifier,
    version,
    build_number,
    installability,
    ios_profile_expires_at,
  };
}
