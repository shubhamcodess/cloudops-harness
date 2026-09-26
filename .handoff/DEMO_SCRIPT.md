# Demo script: cloudops-harness on TrueForge

Verified against this repo's actual detectors/planner/pricing code (not guessed).
Uses `fixtures/node-api` because its detected profile is deterministic and I ran
the full pipeline against it locally to confirm every step below actually happens
in this order. Swap in a real GitHub URL for the recorded take (see §7) — same
script, just read the real `analyze_repo` summary before answering the interview
instead of the one printed here.

## 0. Before you hit record

- TrueForge running (`./scripts/start-forge.sh`), UI at http://localhost:8790.
- Providers registered (`./scripts/setup-models.sh` exited 0 for openrouter).
- MCP server running (`./scripts/start-mcp.sh`), confirm `curl localhost:8830/healthz` → `{"ok":true}`.
- Agent registered (`packages/agents/src/register.ts` printed "registered MCP server + agent cloudops-harness on ...").
- Open the `cloudops-harness` agent in the TrueForge UI, start a new conversation.
- Optional but recommended: install `opentofu`, `helm`, `conftest`, `gitleaks`, and have Docker running,
  so `verify_artifacts` actually executes checks instead of skipping them (see §5 caveat).

## 1. Input — the first message you type

```
Analyze the repo at fixtures/node-api and recommend the cheapest deployment
that keeps data in the EU and meets GDPR. p95 latency under 250ms, 99% uptime,
budget around $1500/month.
```

(A local path resolves relative to where the MCP server is running, i.e. the repo root —
`fixtures/node-api` works as-is. For the real recording, replace this with an `https://` GitHub URL.)

## 2. Processing, turn 1 — repo analysis (no user input needed)

The agent calls `start_run` then `analyze_repo` and should summarize in ~2 lines, matching
what the tool actually returns for this fixture:

```
workloadType: service
languages: [typescript]
services: [{ name: "node-api", kind: "service", port: 3000 }]
datastores: [postgres]
ai: { isAi: false, mcpServer: false, needsSandbox: false }
secretsCount: 2, piiCount: 0
```

Expect something like: *"This is a TypeScript Node API with a Postgres datastore, two
secrets on disk, no AI/agent traits. Let me ask a few things that change cost or compliance."*

## 3. Processing, turn 2 — the interview (one batched turn)

`next_questions` returns these 10 fields in this exact order (verified against `planQuestions`
for this profile — no AI traits, so `llmTokensPerDay`/`llmModel` are skipped). The agent should
ask all of them together via TrueForge's ask-user-questions UI, pre-filled with the defaults shown:

| # | Field | Prompt | Default | Your answer for the demo |
|---|---|---|---|---|
| 1 | dataResidency | Where must user data live? | none | **eu** |
| 2 | availabilityTarget | Availability target? | 0.99 | 0.99 (accept default) |
| 3 | latencyP95Ms | Acceptable p95 latency (ms)? | 250 | 250 (accept default) |
| 4 | peakRps | Peak requests per second? | 10 | **200** |
| 5 | monthlyBudgetUsd | Monthly budget in USD (optional)? | — | **1500** |
| 6 | userRegions | Where are your users? | ["us-east"] | **["eu-west"]** |
| 7 | allowedProviders | Which cloud providers are allowed? | ["aws","gcp"] | ["aws","gcp"] (accept default) |
| 8 | existing | Existing deployment (optional)? | — | **"AWS us-east-1, ~$1800/month"** |
| 9 | avgRps | Average requests per second (optional)? | — | **skip / leave blank** |
| 10 | dataClasses | Data classes handled? | ["none"] | ["none"] (accept default) |
| 11 | compliance | Compliance requirements? | [] | **["gdpr"]** |

Fields 5, 8, 9 are marked `optional: true` — deliberately leave **avgRps blank** in the demo.
This is the exact bug I fixed on this branch: before the fix, `submit_answers` never returned
`"complete"` while any field was unanswered, even ones the tool itself labels "(optional)" and
gives no default for. Leaving one blank and watching the run still reach `price_and_decide` is
worth calling out live — it's proof the interview logic won't stall on a real optional answer.

Once you submit, `submit_answers` should report `status: "complete"` (confirmed against the
actual code path in `packages/mcp/test/tools.test.ts`).

## 4. Processing, turn 3 — pricing and decision

The agent calls `price_and_decide`, then should render (per its own instructions) a
cost-comparison table/chart, not a wall of text. Expect a shape like:

- **Chosen candidate**: cheapest architecture across AWS/GCP whose `meets` flags are all true
  (latency, availability, residency, budget) — will only include `eu-*`/`europe-*` regions
  because `dataResidency: eu` hard-excludes non-EU regions before pricing.
- **Runner-ups**: 3–5 more candidates sorted by `monthlyUsd`.
- **Savings card**: baseline $1800/mo (your `existing` answer) vs the chosen candidate's
  monthly cost — this card only appears because you supplied `existing`.
- Ask "why did you pick that one, and what about compliance?" to trigger `explain_decision` —
  expect per-line SKU IDs, fetch dates, and a GDPR compliance report (allowed regions, any
  flagged cross-region/egress issues).

Exact dollar figures depend on live AWS Price List / GCP Billing Catalog data pulled at
run time, so don't script a number — read whatever the tool actually returns on the day.

## 5. Processing, turn 4 — generate and verify

Say: **"Generate the artifacts and verify them."**

`generate_artifacts` → `verify_artifacts`. From my local run against this same fixture,
expect on the order of **29 files**: `Dockerfile`, `.dockerignore`, `.github/workflows/deploy.yml`,
a full Helm chart (`Chart.yaml`, templates, `_helpers.tpl`, NOTES.txt, ExternalSecret,
NetworkPolicy, HPA, PDB), Terraform for the chosen architecture, a secrets manifest, and
`DEPLOYMENT_HANDBOOK.md` + `AGENT_RUNBOOK.md`.

The agent should report a **proof checklist** (pass/fail/skip), honestly, per its instructions —
it must say what failed rather than hide it. Caveat for the recording: `verify_artifacts` shells
out to `tofu`, `helm`, `conftest`, `gitleaks`, and Docker; whatever isn't installed on your
machine shows as `skipped`, not `failed`, and the overall verdict becomes `"partial"` instead of
`"passed"`. That's expected and fine to narrate ("verified everything my machine has tooling for;
in CI this also runs a sandboxed emulator apply").

## 6. Processing, turn 5 — the approval gate

Say: **"Deliver it to ./demo-output"** (or ask for a git branch instead).

Because `cloudops-harness`'s MCP registration sets `require_approval_for_tools: ["deliver"]`,
TrueForge should pause here and show an approval prompt before the tool actually runs — this
is the hackathon's "human approval before irreversible actions" requirement, live. Approve it
on screen. `deliver` then copies the generated files to `./demo-output` (or commits them to a
`cloudops-harness/<appName>` branch if you asked for git mode) and returns `{ mode, target, at }`.

## 7. Output — what a finished run looks like

By the end you should have, in order, visibly in the conversation:

1. A two-line workload summary (turn 2).
2. One batched interview turn, completed with 2 of 3 optional fields answered and one left blank.
3. A cost/candidate comparison (table or chart) + a savings card ($1800 baseline vs chosen).
4. A compliance/GDPR note confirming only EU regions were considered.
5. A proof checklist (pass/fail/skip per check) — not a bare "done".
6. An approval prompt you had to click through before delivery.
7. A delivery confirmation naming the target path or branch.
8. If asked, `get_ledger` returns `{ verify: { ok: true }, entries: [...] }` — the hash-chained
   audit trail, one entry per stage transition (created → profiled → requirements → decided →
   generated → verified → delivered).

## 8. Optional 60-second add-on: the AI-native differentiator

Start a second run against `fixtures/ai-agent` and say the same opening line but point at that
path instead. Confirmed detected profile: `workloadType: ai-agent`, `ai.isAi: true`,
`ai.needsSandbox: true`. This time the interview adds two *required* questions the node-api run
never showed — `llmTokensPerDay` and `llmModel` — and `generate_artifacts`/the crew instructions
call out sandboxing, egress allow-listing, and model-key handling. Good 30-second beat to show
this isn't just "any Dockerfile generator" — it understands agent workloads specifically.

## 9. If it doesn't match this script

- **422 "Unknown model — provider not configured"** on agent registration → `setup-models.sh`
  didn't run or your API key env var is empty; re-run it and check it printed `HTTP 200`.
- **Interview never says "complete"**, keeps re-asking `monthlyBudgetUsd`/`existing`/`avgRps`
  forever → you're on a commit before this branch's fix; `git pull` the
  `claude/bold-darwin-cj64im` branch.
- **Every verify check shows `skipped`** → expected without `tofu`/`helm`/`conftest`/`gitleaks`/
  Docker installed locally; verdict reads `"partial"`, which is fine to narrate, not a bug.
- **`deliver` runs without an approval prompt** → check the agent's MCP server manifest still has
  `require_approval_for_tools: ["deliver"]` (re-run `register.ts` if you edited the spec).
