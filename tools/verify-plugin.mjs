import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pluginDir = join(root, 'plugins/appbarn');
const read = async path => readFile(join(root, path), 'utf8');
const json = async path => JSON.parse(await read(path));

const portable = await json('plugins/appbarn/plugin.json');
const claude = await json('plugins/appbarn/.claude-plugin/plugin.json');
const claudeMarket = await json('.claude-plugin/marketplace.json');
const copilotMarket = await json('.github/plugin/marketplace.json');
const codexMarket = await json('.agents/plugins/marketplace.json');

assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
assert.match(portable.name, /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
assert.equal(portable.name, 'appbarn');
assert.equal(portable.license, 'MIT');
assert.ok(!('mcpServers' in portable), 'skills-only plugin must not declare MCP tools');
const pluginEntries = await readdir(pluginDir);
for (const name of pluginEntries) assert.ok(!['hooks', 'scripts', 'mcp.json', '.mcp.json'].includes(name), 'no active agent runtime or MCP: ' + name);

const agentNames = ['appbarn-advisor', 'appbarn-workflow'];
const agentFolders = ['plugins/appbarn/agents', 'plugins/appbarn/com.github.copilot/agents'];
for (let i = 0; i < agentFolders.length; i++) {
  const found = (await readdir(join(root, agentFolders[i]))).sort();
  const wanted = agentNames.map(name => name + (i === 0 ? '.md' : '.agent.md')).sort();
  assert.deepEqual(found, wanted, 'only two focused client-specific agents are supported');
  for (const name of agentNames) {
    const filename = name + (i === 0 ? '.md' : '.agent.md');
    const agent = await read(agentFolders[i] + '/' + filename);
    assert.match(agent, /^---\\nname: [a-z0-9-]+\\ndescription: [^\\n]+\\n/);
    assert.equal(agent.match(/^name: (.+)$/m)?.[1], name);
    assert.ok(agent.length <= 1600, 'agent must be a thin wrapper: ' + filename);
    assert.ok(!/^skills:|^hooks:|^mcpServers:|^permissionMode:|^memory:|^background:/m.test(agent),
      'no automatic skill preloading, elevated permissions, background workers or extra runtime: ' + filename);
    const allowed = name === 'appbarn-advisor' ?
      ['appbarn-get-started', 'appbarn-install'] :
      ['appbarn-get-started', 'appbarn-builds', 'appbarn-install'];
    for (const skill of allowed) assert.ok(agent.includes('`' + skill + '`'),
      'agent must route to existing skill ' + skill + ': ' + filename);
    assert.ok(/Do not|Never|do not|never/.test(agent), 'agent must state a non-action boundary');
  }
}

assert.equal(claude.name, portable.name);
assert.equal(claude.version, portable.version);
for (const market of [claudeMarket, copilotMarket, codexMarket]) {
  assert.equal(market.name, 'appbarn-official');
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, portable.name);
  const source = market.plugins[0].source;
  assert.equal(typeof source === 'string' ? source : source.path, './plugins/appbarn');
}
assert.equal(codexMarket.plugins[0].policy.installation, 'AVAILABLE');
assert.equal(codexMarket.plugins[0].policy.authentication, 'ON_INSTALL');

const allowedKeys = new Set(['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions']);
assert.deepEqual(Object.keys(portable).filter(x => !allowedKeys.has(x)), []);
const subdirs = (await readdir(join(pluginDir, 'skills'), { withFileTypes: true }))
  .filter(x => x.isDirectory()).map(x => x.name).sort();
assert.deepEqual(subdirs, ['appbarn-builds', 'appbarn-get-started', 'appbarn-install']);

const source = await read('src/index.ts');
const usage = source.match(/const USAGE = `([\s\S]*?)`;/)?.[1];
assert.ok(usage, 'CLI usage must be present in src/index.ts');
const known = [
  'appbarn --help', 'appbarn --version',
  'appbarn config set', 'appbarn config show',
  'appbarn upload', 'appbarn builds list', 'appbarn builds download'
];
for (const cmd of known) {
  assert.ok(cmd.includes('appbarn config') || usage.includes(cmd), `missing CLI usage for ${cmd}`);
}
const readme = await read('README.md');
assert.match(readme, /## AI agent plugin/);
assert.match(readme, /copilot plugin marketplace add/);
assert.match(readme, /claude plugin marketplace add/);

for (const name of subdirs) {
  const md = await read(`plugins/appbarn/skills/${name}/SKILL.md`);
  assert.match(md, /^---\nname: [a-z0-9-]+\ndescription: .+\n---\n/);
  assert.equal(md.match(/^name: (.+)$/m)?.[1], name);
  const description = md.match(/^description: (.+)$/m)?.[1] ?? '';
  assert.ok(description.length >= 40 && description.length <= 240, 'skill description must stay compact');
  assert.ok(md.length < 5000, 'on-demand skill instructions must stay concise');
  assert.ok(!/\$\{?APPBARN_TOKEN\}?=\S+/.test(md), 'do not embed token assignments');
  for (const block of md.matchAll(/```sh\n([\s\S]*?)```/g)) {
    for (const line of block[1].split('\n').map(s => s.trim()).filter(Boolean)) {
      assert.ok(line.startsWith('appbarn '), `unrecognized shell example: ${line}`);
      assert.ok(known.some(cmd => line === cmd || line.startsWith(cmd + ' ')),
        `unreleased CLI command in skill ${name}: ${line}`);
    }
  }
}
assert.equal(await read('plugins/appbarn/plugin.json').then(x => JSON.parse(x).version), '0.2.0');
// The plugin is source-only. Keep it out of the runtime npm tarball.
const pkg = await json('package.json');
assert.ok(!pkg.files.some(x => x.startsWith('plugins/')));
console.log('AppBarn plugin v' + portable.version + ': manifests, 3 skills, 2 thin agents per supported client, and CLI examples verified');
