import { existsSync, mkdirSync, readdirSync, statSync, cpSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join, resolve, sep, dirname } from "node:path";
import { detectRepo } from "@smc/detectors";
import { applyAnswers, planQuestions } from "@smc/engine";
import { buildCandidates, decide, allowedRegions, complianceReport } from "@smc/policy";
import { loadPriceBook, createPriceBook, type PriceBook as PricingBook } from "@smc/pricing";
import { adaptPriceBook } from "@smc/app";
import { generateArtifacts } from "@smc/iac-gen";
import { buildSecretsManifest, generateHandbook, redact } from "@smc/sop";
import { verifyArtifacts } from "@smc/verifier";
import type { Candidate, Provider, Requirements, Sku } from "@smc/contracts";
import { RunStore } from "./store.js";
import { shallowClone } from "./git.js";

type StartArgs = { source: string; appName?: string };
type IdArgs = { runId: string };
type AnswersArgs = { runId: string; answers: Record<string, unknown> };
type DeliverArgs = { runId: string; mode: "write-to-directory" | "git-branch"; target: string };

export interface ToolDeps {
  /** override for tests: use an in-memory PriceBook. */
  priceBook?: PricingBook | (() => Promise<PricingBook>);
  /** override clone for tests (source is a local path only) */
  clone?: (url: string, dest: string) => Promise<void>;
}

export function makeTools(store: RunStore, deps: ToolDeps = {}) {
  return {
    async start_run(a: StartArgs) {
      const src = String(a.source ?? "").trim();
      if (!src) throw new Error("source required");
      const rec = store.create(src, a.appName);
      let workspace: string;
      if (/^https:\/\//.test(src)) {
        workspace = store.workspaceDir(rec.id);
        const clone = deps.clone ?? shallowClone;
        await clone(src, workspace);
      } else {
        const abs = resolve(src);
        if (!existsSync(abs)) throw new Error("local path does not exist");
        workspace = abs;
      }
      rec.workspace = workspace;
      store.appendLedger(rec, "created", "start_run", { source: src }, { workspace });
      store.save(rec);
      return { runId: rec.id, appName: rec.appName, workspace };
    },

    async analyze_repo(a: IdArgs) {
      const rec = store.get(a.runId);
      if (!rec.workspace) throw new Error("no workspace on run");
      const profile = await detectRepo(rec.workspace);
      rec.profile = profile;
      rec.stage = "profiled";
      store.appendLedger(rec, "profiled", "analyze_repo", {}, profileSummary(profile));
      store.save(rec);
      return profileSummary(profile);
    },

    next_questions(a: IdArgs) {
      const rec = store.get(a.runId);
      store.requireStage(rec, "profiled", "next_questions");
      const remaining = planQuestions(rec.profile!, (rec.answers ?? {}) as Partial<Requirements>);
      return { remaining: remaining.map((q) => ({ id: q.field, prompt: q.prompt, type: q.type, options: q.options, default: q.default, why: q.why, optional: !!q.optional })) };
    },

    submit_answers(a: AnswersArgs) {
      const rec = store.get(a.runId);
      store.requireStage(rec, "profiled", "submit_answers");
      const merged = { ...(rec.answers ?? {}), ...(a.answers ?? {}) } as Partial<Requirements>;
      rec.answers = merged;
      const remaining = planQuestions(rec.profile!, merged);
      const required = remaining.filter((q) => !q.optional);
      if (required.length > 0) {
        store.appendLedger(rec, rec.stage, "submit_answers", { keys: Object.keys(a.answers ?? {}) }, { remaining: required.length });
        store.save(rec);
        return { status: "incomplete", remaining: required.map((q) => ({ id: q.field, prompt: q.prompt })) };
      }
      const parsed = applyAnswers({}, merged);
      if (!parsed.ok) throw new Error(`requirements invalid: ${parsed.error}`);
      rec.requirements = parsed.requirements;
      rec.stage = "requirements";
      store.appendLedger(rec, "requirements", "submit_answers", { keys: Object.keys(merged) }, { complete: true });
      store.save(rec);
      return { status: "complete", requirementsSummary: reqSummary(rec.requirements) };
    },

    async price_and_decide(a: IdArgs) {
      const rec = store.get(a.runId);
      store.requireStage(rec, "requirements", "price_and_decide");
      const req = rec.requirements!;
      const regions: Partial<Record<Provider, string[]>> = {};
      for (const p of req.allowedProviders) regions[p] = allowedRegions(req, p).map((r) => r.id);
      let book: PricingBook;
      if (deps.priceBook) {
        book = typeof deps.priceBook === "function" ? await deps.priceBook() : deps.priceBook;
      } else {
        book = await loadPriceBook({ providers: req.allowedProviders, regions });
      }
      const candidates = buildCandidates(rec.profile!, req, adaptPriceBook(book));
      const decision = decide(candidates, req);
      rec.cost = { candidates, generatedAt: new Date().toISOString() };
      rec.decision = decision;
      const chosen = candidates.find((c) => c.id === decision.chosenId);
      if (chosen) rec.chosenCandidate = chosen;
      rec.stage = "decided";
      store.appendLedger(rec, "decided", "price_and_decide",
        { providers: req.allowedProviders }, { chosen: decision.chosenId, ranked: decision.ranked.length });
      store.save(rec);
      const table = candidates
        .slice()
        .sort((a, b) => a.monthlyUsd - b.monthlyUsd)
        .slice(0, 6)
        .map((c) => ({ id: c.id, monthlyUsd: round(c.monthlyUsd), meets: c.meets }));
      const savings = decision.savingsVsExistingUsd;
      return {
        chosen: decision.chosenId,
        candidates: table,
        rejected: decision.rejected.length,
        savingsUsd: savings !== undefined ? round(savings) : undefined,
      };
    },

    explain_decision(a: IdArgs & { candidateId?: string }) {
      const rec = store.get(a.runId);
      store.requireStage(rec, "decided", "explain_decision");
      const c = a.candidateId
        ? rec.cost!.candidates.find((x) => x.id === a.candidateId)
        : rec.chosenCandidate;
      if (!c) throw new Error("candidate not found");
      const compliance = complianceReport(rec.requirements!, rec.profile!, c);
      return {
        candidateId: c.id,
        monthlyUsd: round(c.monthlyUsd),
        rationale: rec.decision!.rationale,
        lines: c.lines.map((l) => ({
          label: l.label, quantity: l.quantity, unit: l.unit, monthlyUsd: round(l.monthlyUsd),
          sku: l.sku ? { id: l.sku.skuId, region: l.sku.region, fetchedAt: l.sku.fetchedAt } : undefined,
        })),
        compliance,
      };
    },

    generate_artifacts(a: IdArgs) {
      const rec = store.get(a.runId);
      store.requireStage(rec, "decided", "generate_artifacts");
      const chosen = rec.chosenCandidate ?? rec.cost!.candidates.find((c) => c.id === rec.decision!.chosenId);
      if (!chosen) throw new Error("no chosen candidate");
      const secrets = buildSecretsManifest(rec.profile!, chosen.provider);
      const iac = generateArtifacts({
        profile: rec.profile!, requirements: rec.requirements!, candidate: chosen,
        secrets, appName: rec.appName,
      });
      const docs = generateHandbook({
        profile: rec.profile!, requirements: rec.requirements!, candidate: chosen,
        decision: rec.decision!, secrets, appName: rec.appName,
      });
      const files = [...iac, ...docs];
      store.writeFiles(rec.id, files);
      rec.files = files;
      rec.secrets = secrets;
      rec.stage = "generated";
      store.appendLedger(rec, "generated", "generate_artifacts", {}, { fileCount: files.length });
      store.save(rec);
      return {
        fileCount: files.length,
        files: files.map((f) => ({ path: f.path, kind: f.kind, bytes: Buffer.byteLength(f.content, "utf8") })),
      };
    },

    async verify_artifacts(a: IdArgs & { floci?: boolean }) {
      const rec = store.get(a.runId);
      store.requireStage(rec, "generated", "verify_artifacts");
      const floci = a.floci && (await flociReachable());
      const report = await verifyArtifacts(rec.files!, { floci });
      rec.proof = report;
      rec.stage = "verified";
      store.appendLedger(rec, "verified", "verify_artifacts", { floci: !!floci }, { verdict: report.verdict });
      store.save(rec);
      return {
        verdict: report.verdict,
        checks: report.checks.map((c) => ({ name: c.name, status: c.status })),
      };
    },

    deliver(a: DeliverArgs) {
      const rec = store.get(a.runId);
      store.requireStage(rec, "verified", "deliver");
      if (rec.proof!.verdict === "failed") throw new Error("cannot deliver: verify verdict=failed");
      const target = store.safeResolve(a.target);
      const outDir = store.outDir(rec.id);
      if (a.mode === "write-to-directory") {
        mkdirSync(target, { recursive: true });
        cpSync(outDir, target, { recursive: true });
      } else if (a.mode === "git-branch") {
        if (!existsSync(join(target, ".git"))) throw new Error("target is not a git repo");
        const branch = `save-my-cloud/${rec.appName}`;
        run("git", ["-C", target, "checkout", "-B", branch]);
        cpSync(outDir, target, { recursive: true });
        run("git", ["-C", target, "add", "."]);
        run("git", ["-C", target, "commit", "-m", `save-my-cloud: ${rec.appName}`, "--allow-empty"]);
      } else {
        throw new Error(`unknown mode: ${String(a.mode)}`);
      }
      const entry = { mode: a.mode, target, at: new Date().toISOString() };
      rec.deliveries = [...(rec.deliveries ?? []), entry];
      rec.stage = "delivered";
      store.appendLedger(rec, "delivered", "deliver", { mode: a.mode }, entry);
      store.save(rec);
      return entry;
    },

    get_run(a: IdArgs) {
      const rec = store.get(a.runId);
      return { id: rec.id, stage: rec.stage, appName: rec.appName, nextStep: nextHint(rec.stage) };
    },

    get_ledger(a: IdArgs) {
      const rec = store.get(a.runId);
      const l = store.ledgerOf(rec);
      return { verify: l.verify(), entries: rec.ledger };
    },
  };
}

// ---------- helpers ----------

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: "pipe" });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed: ${redact(String(r.stderr))}`);
}

async function flociReachable(): Promise<boolean> {
  try {
    const r = await fetch("http://localhost:4566/_localstack/health").catch(() => null);
    return !!r && r.ok;
  } catch { return false; }
}

function profileSummary(p: Awaited<ReturnType<typeof detectRepo>>) {
  return {
    workloadType: p.workloadType,
    languages: p.languages.slice(0, 6),
    services: p.services.map((s) => ({ name: s.name, kind: s.kind, port: s.port })),
    datastores: p.datastores,
    ai: { isAi: p.ai.isAi, mcpServer: p.ai.mcpServer, needsSandbox: p.ai.needsSandbox },
    secretsCount: p.envVars.filter((v) => v.classification === "secret").length,
    piiCount: p.pii.length,
  };
}

function reqSummary(r: Requirements) {
  return {
    latencyP95Ms: r.latencyP95Ms, availabilityTarget: r.availabilityTarget,
    peakRps: r.peakRps, dataResidency: r.dataResidency,
    allowedProviders: r.allowedProviders, budgetUsd: r.monthlyBudgetUsd,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
function nextHint(stage: string): string {
  const map: Record<string, string> = {
    created: "call analyze_repo",
    profiled: "call next_questions / submit_answers",
    requirements: "call price_and_decide",
    decided: "call generate_artifacts",
    priced: "call generate_artifacts",
    generated: "call verify_artifacts",
    verified: "call deliver",
    delivered: "done",
  };
  return map[stage] ?? "unknown";
}

// Test helper: expose creator of an in-memory PriceBook from Sku[].
export function memoryPriceBook(skus: Sku[]): PricingBook {
  return createPriceBook(skus);
}
