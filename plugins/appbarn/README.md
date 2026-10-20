# AppBarn agent plugin

The official **AppBarn** skills package is in this folder. It works with compatible Agent Plugins clients, and ships Claude Code and GitHub Copilot CLI marketplace entries at the repository root.

**Includes:** `appbarn-get-started`, `appbarn-builds`, `appbarn-install`. The three `SKILL.md` files own workflow steps and decisions. Two optional thin profiles (`appbarn-advisor` for discussion, `appbarn-workflow` for multi-step builds) live under `agents/` for Claude and `com.github.copilot/agents/` for Copilot. They select skills when relevant; they add no workflow logic, hooks, scripts, or MCP runtime.

**Needs:** Node.js 22+, the published `appbarn-cli` package, and an AppBarn account with a scoped Automation Token for API actions. No token is needed to read the skills. No MCP server is bundled yet. Skills cannot create Share Links or install apps on devices on their own.

Skill descriptions can be read first and detailed instructions loaded when relevant. Agent profiles deliberately do **not** preload every skill; they are optional and can add an extra model context, so use skills directly for simple tasks. This may save context compared with pasting a full guide into each chat. Savings depend on the client and are **not measured**.

See the [root README](../../README.md#ai-agent-plugin) for Claude, Copilot, Codex and Cursor installation. Inspect `appbarn --help` before asking an agent to act. Never put your token into a prompt, repository or plugin file.

Version `0.2.0` is the **plugin** version, separate from the npm CLI package version.
