# AGENTS.md

Instructions for any AI coding agent working in this repo. Other agent files (`CLAUDE.md`, `GEMINI.md`, Copilot, Cursor) point here; keep changes in this file only.

## Project

An AI agent for the TrueForge hackathon ("Agents That Act"). It runs on [TrueForge](https://trueforge.dev), reaches real systems through MCP tools, executes generated code only in a sandbox, and pauses for human approval before any irreversible action.

_Scope and stack are finalized in the README once the idea is locked._

## Non-negotiables

- Irreversible actions (delete, publish, revoke, reply to a customer) always require explicit human approval.
- Generated or untrusted code runs in the sandbox, never on the host.
- No secrets in the repo, logs, or demo material. Use `.env`; document keys in `.env.example`.
- Only free, open-source tools and services that offer a free API key.

## Conventions

- Match the surrounding code's style, naming, and comment density. Comment the why, not the what.
- Keep docs short and plain. Update the README when behavior changes.
- Small, focused commits with imperative subjects. Do not add AI co-author trailers.
- Run tests and the linter before committing.

## TrueForge

Docs index: https://trueforge.dev/llms.txt. Every docs page has a `.md` variant (append `.md` to the URL). Fetch only the page you need.
