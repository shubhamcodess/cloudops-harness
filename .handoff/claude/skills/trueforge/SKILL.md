---
name: trueforge
description: Use for anything involving TrueForge (agent harness the hackathon agent must run on): setup, agents, MCP servers, skills, sandbox, approvals, SDK/API. Points to docs to fetch on demand.
---

TrueForge = open-source (MIT) agent harness: agent loop, MCP tools, skills, sandbox-as-tool, human approvals, subagents. Node 22.14+. Repo: https://github.com/truefoundry/trueforge

Run locally: `npx @truefoundry/trueforge@latest` then http://localhost:8790 (SQLite, no auth; localhost only). Hosted: Docker Compose (port 8791) or Helm.

## How to use docs (token-cheap)
1. Find the page in `.local/trueforge/llms-index.md` (local copy of https://trueforge.dev/llms.txt; refetch if stale).
2. Fetch only that page with the `.md` suffix, e.g. `curl -s https://trueforge.dev/api/use-agent.md`.
3. For API shapes use `https://trueforge.dev/api-reference/...` pages from the index. For source truth use the GitHub repo (`packages/`, `python/trueforge_sdk`, `docs/`).

## Common entry points
- Setup: /quickstart, /harness/initial-setup, /models, /mcp-servers, /skills, /sandbox
- Build an agent: /create-agent/overview
- Approvals, questions, streaming (SDK): /api/use-agent, /api/overview, /api/quickstart
- Harness features: /key-features/overview (sandbox, code mode, subagents, large responses)
- Schedules: /schedules
- UI embedding: /chat-ui, /ui-sdk/...

Record anything learned that's project-specific in `.local/trueforge/notes.md`.
