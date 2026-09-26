# save-my-cloud: hardened development plan
Version 1, 2026-09-26. Supersedes usecase-plan.md. Working title, may change.

## 0. TIMEBOX: 2.5h build window (overrides section 12)
Vertical slice, deterministic core first. Helm is IN scope (enterprise standard). Cut Kustomize, Azure, hybrid, web enrichment and GDPR depth to stretch/roadmap unless ahead.
0:00-0:15 monorepo, contracts, ledger, spikes (Floci/Docker, pricing fetch)
0:15-0:45 detectors (Node/Python/static/npm/MCP/AI-agent) + pricing-mcp (AWS bulk, GCP catalog)
0:45-1:15 state machine, question planner, decision matrix, region/GDPR rules (basic)
1:15-1:50 Terraform + Helm chart + Dockerfile + CI generation, verify (validate/plan, Floci if spike ok), ProofReport
1:50-2:15 secrets manifest + mocks, SOP handbook, minimal dashboard + approval
2:15-2:30 hardening, demo repos, buffer. README/video/GitHub separate, after.
Stretch in order: Kustomize, GCP Floci, Firecrawl enrichment, hybrid, Azure.

## 1. Product
Give it a repo (URL or upload). It understands the workload, asks only the questions that matter, prices real options on AWS/GCP/Azure/hybrid from live SKU data, picks the cheapest architecture that meets latency, availability, budget and compliance, generates deployable IaC, PROVES it in a local cloud, and hands over an SOP handbook. Output = real money saved and a deployment you can trust, not a diagram.

Principles
1. Decide in code, generate with LLMs. Every choice that can be a fact is a rule.
2. Nothing is claimed without evidence (build, validate, plan, emulator apply, priced SKUs).
3. Nothing irreversible without human approval.
4. Secrets never enter model context. Sandbox uses mocks.
5. Compliance (GDPR/residency) is a hard constraint in the decision, not a footnote.
6. Same input, same output (deterministic core, hash-checked).

## 2. Workload taxonomy (detectors, deterministic first)
Static site; Node/Python/Java/Go service; monolith vs microservices vs monorepo; npm/PyPI package (publish flow, no runtime); worker/cron; data job.
AI-native (differentiator): AI agents, agent harnesses, MCP servers, AI tools, RAG apps. Detect via deps and files (TrueForge, LangGraph, CrewAI, AI SDK, MCP SDKs, model client libs, vector DB clients). AI-aware planning: sandbox requirement, egress allow-lists, approval-gate placement, MCP server exposure and authN, model key handling, session store, and an LLM token cost line in the cost model (tokens/day x price per model) so cost includes inference, not just compute.

## 3. Architecture
Pipeline as an XState v5 state machine (typed, inspectable, replayable):
INGEST -> DETECT -> INTERVIEW -> ENRICH(web) -> COST -> DECIDE -> GENERATE -> VERIFY -> REVIEW(approval) -> DELIVER -> SOP
Each state has guards (rules) and an audit entry in a decision ledger (JSON, hash-chained).

Decision hierarchy (the determinism hook)
1. Rules / decision tables (pure functions, unit-tested).
2. Scored decision matrix over priced candidates (weights from Requirements).
3. Constrained LLM choice: enum-only structured output, temperature 0, confidence threshold; below threshold -> ask the human. Never free text for a decision.
4. Free generation only for artifacts and prose, always validated after.
DecisionEngine interface with pluggable backends: rules | constrained-LLM (AI SDK + Zod, any provider incl. Ollama) | Jev (TypeSafe System One, optional adapter: hosted, early access, $42 per billion input tokens, no known free tier, not open source, so never a hard dependency).

Agents on TrueForge (subagents with typed handoffs through Zod-validated JSON in the workspace)
- Repo Analyst, Requirements Interviewer, Cost Analyst, Architect, Artifact Writer, Verifier, Compliance Officer, SOP Writer. Orchestrator = the state machine; agents are workers called per state. Interviewer asks only for facts the detectors could not infer (question list derived from missing fields, ordered by decision impact).
Connectors (MCP): pricing-mcp (ours), GitHub, cloud read-only inventory, Firecrawl (web), Floci endpoints.

## 4. Web intelligence
Firecrawl MCP (hosted free tier, official MCP server) for search/scrape of docs, pricing pages, framework deploy guidance; fallback self-hosted SearXNG + Crawl4AI (Apache-2.0; self-hosted Firecrawl search is limited). Rules: web content is untrusted data (prompt-injection defense), every fact cited with URL + fetch date, results cached, allow-list for authoritative domains, confidence lowered for non-official sources. Feeds a per-stack "knowledge card" the Architect uses.

## 5. Pricing and inventory source map
AWS: Price List API + bulk JSON (free; needs AWS creds for API, bulk file needs none); inventory via describe/Resource Explorer/Config; Compute Optimizer (free opt-in) for rightsizing; avoid Cost Explorer ($0.01/request) except one cached pull.
GCP: Cloud Billing Catalog API `services/{id}/skus` (free, API key) = exact SKUs and unit prices per region; Cloud Asset Inventory `searchAllResources` (free) = exact resources; Recommender API (free) = idle/rightsize; BigQuery billing export = actuals (optional, needs setup).
Azure: Retail Prices API (no key). Cross-check: Infracost Pricing API (free key, all three clouds) and terraform-plan pricing.
Our pricing-mcp normalizes to Sku{provider, service, region, unit, price, currency, effectiveDate, source}; disk-cached; every CostModel line cites its SKU id and date. Accuracy gate: within 2 percent of official calculator on fixture scenarios.

## 6. IaC and verification
Generate Terraform (primary), Helm charts, Kustomize overlays (per env). Validators: terraform fmt/validate/plan, tflint, checkov or trivy config, helm lint + template, kustomize build, kubeconform, conftest (OPA) policies. Proof: docker build; apply to Floci (AWS on 4566, GCP on 4588); K8s proof on kind/k3d if available in sandbox; smoke test; plan-based cost via Infracost. Spike first: Floci and Docker inside Daytona.
Artifacts: Dockerfile, .dockerignore, IaC, CI/CD (GitHub Actions), env/config matrix, secrets manifest, budget alerts, tagging.

## 7. Secrets and config management
Detect (gitleaks-style scan of repo and history), classify (secret vs config vs public), map to store per target: AWS Secrets Manager / SSM, GCP Secret Manager, Vault, External Secrets Operator, SOPS. Output secrets manifest (names, owners, rotation policy, injection method), never values. Sandbox runs use generated mock secrets/dummy envs; the sandbox env has no real credentials. Redact before any model call; tests assert no secret pattern reaches prompts or logs.
Config: 12-factor env matrix, per-env overlays, feature flags note, drift guard.

## 8. GDPR and location awareness
Requirements include data classes (PII, special category, payment), data subject regions, residency mandate. Detectors flag PII handling in code (fields, analytics, logging, third-party SDKs). Region policy engine (Rego/deterministic): allowed regions per residency rule, EU-only options, sovereignty tiers, cross-region replication and backups constrained, egress to non-EU flagged. Outputs: compliance report (data map, regions, encryption, retention, logging, sub-processors, transfer mechanisms to review), and a cost delta for compliance ("EU-only costs X percent more"). Not legal advice; flagged items need DPO review.

## 9. Deliverables per run
Decision ledger; cost/performance frontier (interactive); ProofReport; IaC branch or PR; SOP + handbook (below).
SOP handbook (human + agent readable): prerequisites and access, environments, step-by-step deploy, verification checks, rollback, secrets rotation, scaling, cost monitoring and budgets, incident runbook, compliance checklist, decommission. Written as markdown plus an AGENTS.md-style machine section so an AI agent can follow it.

## 10. Quality and regression (enterprise bar)
- Fixture corpus of 12+ repos (static, Node API, Python API, Java monolith, monorepo microservices, npm package, MCP server, AI agent app, RAG app, with-secrets, PII app).
- Unit: rules, region policy, decision matrix, pricing normalization.
- Golden/snapshot: detection output and generated artifacts per fixture; determinism test (same input -> identical hash).
- Contract: Zod schemas on every handoff; agents cannot pass invalid state.
- Integration: Floci-based apply per fixture; pricing accuracy vs official.
- LLM evals: constrained-choice accuracy on labeled cases; run on free models, gate on gpt-5-4-mini.
- Security: secret-leak tests, prompt-injection tests on web content, sandbox-only execution tests, approval-gate-blocks tests.
- CI on every PR. Budget: OpenAI spend cap; dev on free models.

## 11. Stack and repo layout
TypeScript, Node 22, pnpm workspaces, XState v5, Zod, Vitest, AI SDK for direct constrained calls, TrueForge SDK for agents, React + Vite dashboard (recharts/visx frontier chart), Terraform/Helm/Kustomize/Conftest CLIs, Floci.
packages/: contracts, engine (state machine, decision engine, ledger), detectors, pricing-mcp, policy (region/GDPR rego), iac-gen, verifier, sop, agents (TrueForge specs, prompts), ui. fixtures/, docs/, scripts/.
Git: dev in a worktree on a feature branch, main stays releasable; conventional commits; product can also deliver output as a branch/PR on the target repo. No AI co-author trailers.

## 12. Phases (exit criteria; cut line after P5)
P0 Foundations: worktree branch, monorepo, CI, contracts, ledger, TrueForge wiring via LLM_PROVIDER/LLM_MODEL. Spikes: Floci-in-Daytona, remote MCP hosting, Docker-in-sandbox.
P1 Detect: detectors + fixtures + snapshots (incl. AI/MCP detection).
P2 Pricing: pricing-mcp AWS+GCP(+Azure), cache, accuracy tests.
P3 Interview + Decide: state machine, question planner, decision matrix, region/GDPR policy.
P4 Generate + Verify: Terraform first, then Helm/Kustomize; Floci proof; ProofReport.
P5 Secrets + SOP: secrets manifest, mocks, handbook generator. (CUT LINE: everything above must be solid)
P6 UI + approval flow + delivery (branch/PR); web enrichment (Firecrawl).
P7 Polish: real AWS deploy (approved), demo repos, video, README (SVGs, screenshots, GIFs), submission.

## 13. Risks and mitigations
Floci/Docker not runnable in Daytona -> run emulator outside, or reduce proof to validate+plan+Infracost, keep Floci for local CI.
Pricing drift/inaccuracy -> cite SKU+date, cross-check two sources, freeze fixtures with dated snapshots.
Scope creep -> phases with cut line; stretch items only after P5.
LLM nondeterminism -> decision hierarchy, temperature 0, schema enforcement, low-confidence -> ask human.
Free-model weakness on IaC -> free models for dev loops, gpt-5-4-mini for Architect/Writer, snapshot tests to catch regressions.
Web content injection -> untrusted-data handling, allow-lists, citations.
Credit burn -> cost policy in CLAUDE.md, spend caps.
Time -> checkpoint reminders; README/video/GitHub reserved (last 25 percent).

## 14. Success metrics
Detection accuracy >= 95 percent on fixture corpus; deterministic re-runs 100 percent identical; price within 2 percent of official calculator; every generated IaC passes validate + policy + emulator apply; zero secret leaks in tests; demo shows real savings figure vs a baseline deployment.

## 15. Needed from user (into .env, I will give steps)
INFRACOST_API_KEY, DAYTONA_API_KEY, GITHUB_TOKEN, AWS (dedicated IAM user, read-only + pricing), GCP_API_KEY (Billing Catalog) optional, FIRECRAWL_API_KEY, TYPESAFE_API_KEY optional.

## 16. Sandbox, safety and hackathon-compliance checklist
- TrueForge sandbox = Daytona (needs DAYTONA_API_KEY, $200 free credits). Everything generated or cloned runs there: repo clone/index, docker build, tofu validate/plan, helm lint/template, conftest, gitleaks, Floci apply (if spike passes). Host never executes untrusted code.
- Sandbox env: mock secrets only, no real cloud creds. Real AWS/GCP calls happen outside the sandbox via read-only MCP tools.
- Approval gates (TrueForge approvals): open PR, real tofu apply, create secrets, any delete. Tests prove each gate blocks.
- Rules checklist for submission: runs on TrueForge; reaches real systems (GitHub, AWS/GCP price and inventory APIs); sandboxed code; human approval before irreversible actions; AI tools disclosed in README; no keys in repo or demo video; own accounts only.
- Helm: generate chart (deployment, service, ingress, HPA, PDB, config, ExternalSecret), values per env; verify with helm lint + template + kubeconform; optional kind proof.
