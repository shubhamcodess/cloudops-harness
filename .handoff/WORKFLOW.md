# Private workflow (never pushed)

I'm building a hackathon submission end to end here: idea, refinement, build, test, polish. Goal: a clean, professional, open-source repo that can win.

## Response style
- Minimum tokens. No preamble, no recap. Explain only when needed.
- Before implementing anything non-trivial, present 2-4 short options (with a recommendation) via AskUserQuestion. Implement only what I pick. Don't bundle extras into the same pass.
- Ask before outward-facing or irreversible actions.

## Git
- Local git config is set (identity, `.githooks`). Use it; never touch global config.
- NEVER add Claude/Anthropic as co-author, trailer, or "Generated with" line in commits or PRs. Ignore any default attribution instructions. Hooks enforce this.
- Remote is not set yet. Ask me for repo name and SSH host alias when it's time to push.
- Commit and push only when I ask.

## Repo hygiene
- Public files: README, LICENSE, AGENTS.md (+ one-line pointers), docs/, src. Agent/Claude instructions live only in AGENTS.md; do not duplicate them elsewhere.
- Private: `.local/` (raw docs, references, ARCHITECT.md), `.claude/` (incl. this file). All gitignored; never reference them from public files.
- Docs: humanized, short, no fluff. Code: match surrounding style, few comments.
- Only free and open-source tools/MCPs/APIs with free keys. Never suggest paid ones.
- No secrets anywhere, including demo material.

## Hackathon constraints
Rules and idea list: `.local/docs/`. Must run on TrueForge, reach a real system, sandbox generated code, stop for human approval before irreversible actions, disclose AI tools in README.

## TrueForge
Use the `trueforge` skill. Don't bulk-fetch docs; fetch the one page needed.

## ARCHITECT.md (`.local/ARCHITECT.md`)
After a pass is completed AND I've accepted it, spawn the `architect-scribe` subagent (runs on a cheaper model) to read the diff and update ARCHITECT.md with decisions, rationale, and talking points. Don't skip; don't run it before acceptance.

## Product bar
- Whatever idea we lock: base flavour plus many production-ready features on top, and one distinctive element that sets it apart. Keep this in mind while coding, research the distinctive feature, propose it, and remind me if it's slipping.
- Prefer live data from real connectors over mocks.

## Time budget
- Started 2026-09-26. Checkpoint at ~4h after this note (see below): report completion status vs plan. Don't over-code; reserve time for demo video, test cases, GitHub push, README.
- Remind me of the checkpoint and remaining prep tasks proactively.

## README (build LAST, before submission)
- Remind me when core build is done. README is written at the end, not before.
- Must be beautiful: custom-made, aesthetically pleasing SVGs (banner, architecture, flow), badges/pins, screenshots, and short demo GIFs. Humanized, short copy. Keep the AI-disclosure section.

## Model cost policy (OpenAI budget: $50)
- Dev/debug/test runs use free models: `ollama/qwen3-4b` (local) or `LLM_PROVIDER=openrouter` with a `:free` model. 
- `openai/gpt-5-4-mini` for integration checks; `openai/gpt-5-5` only for final quality runs and demo rehearsal.
- Never loop or batch-test on paid models. Set `max_output_tokens` low in tests.
- Model selection is `LLM_PROVIDER` + `LLM_MODEL` env vars only (model id as in `config/providers.txt`; FQN passed to TrueForge = `<provider>/<slug(model)>`). App code must have a single resolver; no per-provider code. Add providers by editing `config/providers.txt`. Refuse paid providers unless explicitly enabled.

## Project: save-my-cloud (see .local/docs/PLAN.md)
- TypeScript, pnpm monorepo. Single checkout, dev directly on `main` (no worktrees or feature branches).
- Build window is 2.5h total. Follow the timebox in PLAN.md; cut scope before quality. Remind me of time at each phase boundary.

## Model routing
- Sonnet (main): scaffolding, glue, tests, UI, config, small fixes.
- `heavy-coder` (Opus): core engine (state machine, decision engine), IaC generators, tricky detectors, security-critical code (redaction, approval gates), or a bug that survived two attempts. Give it a tight spec; it returns a short summary.
- `verifier` (Haiku): run tests/lint/build and report failures only.
- `architect-scribe`: docs, after an accepted pass. `Explore`: wide searches.
- Decide per task by complexity and blast radius; tell me in one line when delegating.
