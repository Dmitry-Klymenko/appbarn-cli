# AppBarn CLI

Small, MIT-licensed [AppBarn](https://app-barn.com) command-line client. Node.js 22+; no application/server code, no bundled signing tools.

## AI agent plugin

**This repository also includes the official AppBarn AI agent plugin**, not just the CLI. The plugin has three skills: [Get started](plugins/appbarn/skills/appbarn-get-started/SKILL.md), [Builds](plugins/appbarn/skills/appbarn-builds/SKILL.md), and [Install](plugins/appbarn/skills/appbarn-install/SKILL.md).

It helps Claude Code, GitHub Copilot CLI, Codex and compatible Cursor agents understand when to use AppBarn and how to use **existing** CLI commands. For Claude Code and Copilot CLI it also includes two **thin custom agents**: `appbarn-advisor` for discussions and `appbarn-workflow` for multi-step requests. Agents select the relevant skills as needed; the three skills remain the only source of workflow procedures. Version **0.1.0** of the plugin is separate from the CLI/npm version. **Skills are guidance, not server access:** install the CLI and configure your own scoped `APPBARN_TOKEN` privately before using AppBarn. No MCP server, automatic token setup, agent-created Share Links or one-click phone installation is included yet.

### Claude Code

```sh
claude plugin marketplace add Dmitry-Klymenko/appbarn-cli
claude plugin install appbarn@appbarn-official
claude plugin list
```

Use `/appbarn:appbarn-get-started` or ask how to retain a build. For longer discussions or multi-step flows, ask Claude Code to delegate to `appbarn:appbarn-advisor` or `appbarn:appbarn-workflow`. These agents invoke relevant skills when needed rather than preloading them.

### GitHub Copilot CLI

```sh
copilot plugin marketplace add Dmitry-Klymenko/appbarn-cli
copilot plugin install appbarn@appbarn-official
copilot plugin list
```

Ask: "Use AppBarn to find a build from this Git commit." For a longer conversation choose `appbarn-advisor` from `/agent`; use `appbarn-workflow` for multi-step Build tasks. These commands apply to **Copilot CLI**, not every GitHub Copilot editor surface.

### Codex and Cursor

- **Codex:** `codex plugin marketplace add Dmitry-Klymenko/appbarn-cli`, then open `/plugins` in a supported Codex client and install `appbarn` from `appbarn-official`. The catalog is [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json).
- **Cursor:** The portable [Agent Plugins package](plugins/appbarn/plugin.json) can be installed as a local plugin through Cursor's Plugins/Customize UI. Copy `plugins/appbarn` to `~/.cursor/plugins/local/appbarn` for local testing. Public Cursor Marketplace listing needs separate submission/review.
- **Xcode/Android Studio:** Use the CLI from the IDE terminal. Native plugin installation is not claimed.

The plugin source, manifests, and test checks live under [`plugins/appbarn`](plugins/appbarn/) and [`tools/verify-plugin.mjs`](tools/verify-plugin.mjs). The npm package intentionally excludes plugin files. Run `npm run verify` to check the plugin, CLI tests and packed npm binary. Agent-client installation and real device behavior require separate testing.

## Install

Version 0.2.4 is the release candidate for this public repository's MIT-licensed package and provenance. The existing npm 0.2.2 package predates the public-repository release and carries the old private-repository metadata. The candidate is not published until its matching tag's publish workflow and registry read-back succeed.

```sh
npm install -g appbarn-cli
appbarn --help
appbarn --version
```

## Use

Create a scoped **Automation Token** in AppBarn, then supply it privately as `APPBARN_TOKEN` (never commit it). Non-secret defaults are stored in `~/.appbarn/config.json`.

```sh
appbarn config set api https://api.app-barn.com
appbarn config set app <app-uuid>
appbarn config set environment <environment-uuid>
appbarn upload build.apk --app-identifier com.example.app --version 1.0 --build-number 1
appbarn builds list
appbarn builds download <build-uuid> --output ./build.apk
```

Other commands: `appbarn resign --help` (local signing prerequisites required). The CLI transports files and calls the API; server-side access, quotas and validation remain authoritative.

## Contribute

**One permanent branch:** `main`. Fork this repository, develop on your own branch and open a pull request. The maintainer controls merges; CI must pass. Read [AGENTS.md](AGENTS.md) for coding, analysis and verification expectations. Run `npm ci && npm run verify` before submitting. Never include credentials, customer builds or signing material.

## Releases

| Git tag | npm channel | Install |
| --- | --- | --- |
| `v0.3.0-rc.1` | `next` (prerelease) | `npm i -g appbarn-cli@next` |
| `v0.3.0` | `latest` (stable) | `npm i -g appbarn-cli` |

Tags must match `package.json` and point to a verified `main` commit; no prerelease branch. Publishing uses GitHub Actions + npm trusted publishing (OIDC), **not** a stored npm token. Maintainer must first configure the npm package's trusted publisher for this repository and `.github/workflows/publish.yml`. Post-publish CI verifies exact npm version and dist-tag, tarball integrity field, public repository metadata and provenance attestation reference. Install the published package and run `npm audit signatures` to cryptographically verify registry signatures/attestations. npm trusted publisher must be configured for this public repo and `publish.yml`, with token publishing disabled after first success. No npm tag or release is created by these verification changes.

## License

[MIT](LICENSE) · Copyright © 2026 Dmitry Klymenko.
