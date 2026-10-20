# AppBarn agent plugin

The official **AppBarn** skills package is in this folder. It works with compatible Agent Plugins clients, and ships Claude Code and GitHub Copilot CLI marketplace entries at the repository root.

**Includes:** `appbarn-get-started`, `appbarn-builds`, `appbarn-install`. The three `SKILL.md` files are the only workflow instructions. The native Claude manifest is a compatibility wrapper.

**Needs:** Node.js 22+, the published `appbarn-cli` package, and an AppBarn account with a scoped Automation Token for API actions. No token is needed to read the skills. No MCP server is bundled yet. Skills cannot create Share Links or install apps on devices on their own.

See the [root README](../../README.md#ai-agent-plugin) for Claude, Copilot, Codex and Cursor installation. Inspect `appbarn --help` before asking an agent to act. Never put your token into a prompt, repository or plugin file.

Version `0.1.0` is the **plugin** version, separate from the npm CLI package version.
