#!/usr/bin/env node
// Read-only post-publish registry verification: exact version, channel and provenance metadata.
const tag = process.argv[2];
if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.[1-9]\d*)?$/.test(tag ?? '')) {
  throw new Error('Expected vX.Y.Z or vX.Y.Z-rc.N');
}
const version = tag.slice(1);
const channel = version.includes('-rc.') ? 'next' : 'latest';
const base = 'https://registry.npmjs.org';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('npm registry read failed: HTTP ' + response.status);
  return response.json();
}
let detail, tags;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    [detail, tags] = await Promise.all([
      getJson(base + '/appbarn-cli/' + encodeURIComponent(version)),
      getJson(base + '/-/package/appbarn-cli/dist-tags'),
    ]);
    if (detail.version === version && tags[channel] === version && detail.dist?.attestations?.url) break;
  } catch (error) {
    if (attempt === 11) throw error;
  }
  if (attempt === 11) throw new Error('npm version/channel/provenance did not become available');
  await pause(5000);
}
if (detail.name !== 'appbarn-cli' || detail.version !== version || tags[channel] !== version) {
  throw new Error('Published package identity, version or channel mismatch');
}
if (detail.repository?.url !== 'git+https://github.com/Dmitry-Klymenko/appbarn-cli.git') {
  throw new Error('Published repository does not match the public CLI source');
}
if (!/^sha512-/.test(detail.dist?.integrity ?? '') || !/^https:\/\//.test(detail.dist?.tarball ?? '')) {
  throw new Error('Published package tarball/integrity missing');
}
if (!/^https:\/\//.test(detail.dist?.attestations?.url ?? '')) {
  throw new Error('Published provenance attestation URL missing');
}
console.log('Verified appbarn-cli@' + version + ' in npm ' + channel + ' with provenance metadata');
