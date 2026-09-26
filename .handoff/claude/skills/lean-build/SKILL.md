---
name: lean-build
description: Token-efficient, high-quality build workflow. Use at the start of any implementation, refactor, debugging, or review pass in this project.
---

Goal: best code per token. Quality gates never get cut; waste does.

## Before coding
- Restate the task in one line. If scope is ambiguous or there are real design choices, ask 2-4 options via AskUserQuestion (recommendation first) and stop. Otherwise proceed.
- For multi-file work, write a short plan (files, steps, test plan) and get a nod before editing.
- Check `.local/ARCHITECT.md` and AGENTS.md only if the task touches design or rules. Don't re-read what's in context.

## While coding
- Read narrowly: Grep/Glob first, then Read with offset/limit. Never cat whole files or trees.
- Batch independent tool calls in one message.
- Edit, don't rewrite. Small diffs. No speculative abstractions, no dead code, few comments (why only).
- Reuse existing helpers and dependencies before adding new ones. Free/open-source only.
- Fetch docs by exact page (`.md` URLs), never bulk. Save durable findings to `.local/trueforge/notes.md` so they aren't re-fetched.
- Delegate wide searches or log-heavy work to a subagent (Explore, or `model: haiku`) so raw output stays out of main context. Keep design decisions and edits in the main thread.
- Use background/Monitor for long commands; don't poll or sleep.

## Quality gates (always)
- Write or update tests with the change; run them plus lint/typecheck. Report failures verbatim, don't paper over.
- Irreversible-action paths need an approval gate and a test proving it blocks. Generated code only runs in the sandbox.
- Never log or commit secrets.
- Before calling a pass done: re-read your own diff once for bugs, leftovers, and style mismatch.

## Output
- Terse. Lead with the result, then only what the user must decide. No recaps of the diff.
- After the user accepts a pass, spawn `architect-scribe`, then suggest the next step.

## Context hygiene
- Suggest /compact or a fresh session at natural boundaries (feature done, context large). Carry state in `.local/` notes, not in chat.
- Keep the distinctive feature and time budget in view; flag drift.
