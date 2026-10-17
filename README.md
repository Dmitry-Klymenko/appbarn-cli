# AppBarn CLI

Small, MIT-licensed [AppBarn](https://app-barn.com) command-line client. Node.js 22+; no application/server code, no bundled signing tools.

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
