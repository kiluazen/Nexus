# Nexus plugins

Installable plugins that connect an agent host to the **same** Nexus backend
(`workers/`) and DB. The app does not change — these are thin manifests.

```
skills/nexus/SKILL.md            canonical skill (single source of truth)
plugins/claude-code/             Claude Code plugin
  .claude-plugin/plugin.json       mcpServers + skills
  skills/nexus/SKILL.md            -> symlink to canonical
plugins/codex/                   Codex plugin
  .codex-plugin/plugin.json        skills + mcpServers -> .mcp.json
  .mcp.json                        MCP server map
  skills/nexus/SKILL.md            -> symlink to canonical
.claude-plugin/marketplace.json  Claude marketplace (repo root)
.agents/plugins/marketplace.json Codex marketplace (repo root)
```

## Install

- Claude Code: `/plugin marketplace add kiluazen/Nexus` then `/plugin install nexus@nexus`
- Codex: `codex plugin marketplace add kiluazen/Nexus`

## Auth / transport — DECISION PENDING

The MCP server block in both manifests currently points at the remote HTTPS
endpoint (`https://mcp.nexus.kushalsm.com/mcp`), so each host runs its own
OAuth flow. This is the zero-code default.

If we instead anchor auth to the CLI (one `nexus auth login` per machine,
reused by every host), the **only** thing that changes is the MCP server block:

- `plugins/claude-code/.claude-plugin/plugin.json` → `mcpServers.nexus`
- `plugins/codex/.mcp.json` → `nexus`

swap the `{ "type": "http", "url": ... }` entry for a stdio command
(e.g. `{ "command": "nexus", "args": ["mcp"] }`) backed by a `nexus mcp`
subcommand that bridges stdio to the remote backend with stored credentials.
Nothing else (skill, marketplace, backend) moves.

## Verify before publishing

- Codex `.mcp.json` remote-URL key (`url`) against the current Codex CLI MCP
  reference — confirmed working in a local `marketplace add` before pushing.
- ChatGPT widget layer (Apps SDK UI) is a separate additive enhancement to
  `workers/src/mcp.ts`, not part of these plugins.
