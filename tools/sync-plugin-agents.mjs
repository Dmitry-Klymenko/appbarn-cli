import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// Claude loads agents/ directly. Copilot requires com.github.copilot/agents/.
// Keep one editable agent body and generate Copilot's client wrapper from it.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = join(root, 'plugins', 'appbarn');
const roles = {
  'appbarn-advisor': ['view', 'grep', 'glob', 'web'],
  'appbarn-workflow': ['view', 'grep', 'glob', 'bash'],
};
const write = process.argv.slice(2).includes('--write');
if (process.argv.slice(2).some(x => x !== '--write' && x !== '--check')) {
  throw new Error('Usage: node tools/sync-plugin-agents.mjs [--check|--write]');
}

for (const [name, tools] of Object.entries(roles)) {
  const sourcePath = join(plugin, 'agents', name + '.md');
  const destinationPath = join(plugin, 'com.github.copilot', 'agents', name + '.agent.md');
  const source = await readFile(sourcePath, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(source);
  assert.ok(match, name + ': expected YAML front matter followed by instructions');
  const values = Object.fromEntries(match[1].split('\n').map(line => {
    const colon = line.indexOf(': ');
    assert.ok(colon > 0, name + ': invalid front matter');
    return [line.slice(0, colon), line.slice(colon + 2)];
  }));
  assert.equal(values.name, name);
  assert.ok(values.description?.length >= 40 && values.description.length < 240);
  assert.deepEqual(Object.keys(values).sort(), ['description', 'name', 'tools']);
  const rendered = [
    '---',
    'name: ' + values.name,
    'description: ' + values.description,
    'tools: [' + tools.map(tool => JSON.stringify(tool)).join(', ') + ']',
    'infer: false',
    '---',
    '',
    match[2],
  ].join('\n');
  if (write) {
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, rendered);
  } else {
    const actual = await readFile(destinationPath, 'utf8');
    assert.equal(actual, rendered, name + ': generated Copilot profile has drifted. Run npm run plugin:agents:sync');
  }
}
console.log(write ? 'Generated Copilot agent profiles from the two canonical agents' : 'Copilot agent profiles match the two canonical agents');
