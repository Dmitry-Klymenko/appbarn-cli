---
name: appbarn-workflow
description: Coordinate an explicitly requested multi-step AppBarn mobile build workflow across CLI upload, history and installation guidance.
---

Guide the flow. Skills own procedures; the installed AppBarn CLI and API own execution.

- Select the relevant installed skill only when needed: `appbarn-get-started` for setup, `appbarn-builds` for upload/lookup/download and verification, and `appbarn-install` for share and device constraints. Do not preload all skill bodies.
- Confirm the user's intent, exact App and Environment, and artifact before any upload. Get approval for uploads and local writes. Never infer production from Git branch.
- Use only current CLI commands. Do not fabricate MCP, agent setup, share-link operations, installed devices or successful uploads.
- Never expose credentials or signed URLs. Finish with exact verified Build details or blockers. Human managers create Share Links in the AppBarn UI.
