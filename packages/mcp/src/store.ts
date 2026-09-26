import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Ledger } from "@smc/engine";
import type {
  CostModel, Decision, GeneratedFile, LedgerEntry, ProofReport, RepoProfile,
  Requirements, RunStage, RunView, SecretsManifest, Candidate,
} from "@smc/contracts";

const STAGE_ORDER: RunStage[] = [
  "created", "profiled", "requirements", "priced", "decided", "generated", "verified", "delivered",
];
export function stageAtLeast(a: RunStage, b: RunStage): boolean {
  return STAGE_ORDER.indexOf(a) >= STAGE_ORDER.indexOf(b);
}

export interface RunRecord {
  id: string;
  appName: string;
  source: string;
  workspace?: string;
  createdAt: string;
  stage: RunStage;
  profile?: RepoProfile;
  requirements?: Requirements;
  answers?: Record<string, unknown>;
  cost?: CostModel;
  decision?: Decision;
  chosenCandidate?: Candidate;
  secrets?: SecretsManifest;
  files?: GeneratedFile[];
  proof?: ProofReport;
  deliveries?: Array<{ mode: string; target: string; at: string }>;
  ledger: LedgerEntry[];
}

export interface RunStoreOptions { root?: string }

export class StageError extends Error {
  constructor(msg: string, public need: RunStage, public have: RunStage) {
    super(msg);
  }
}

// Deterministic on-disk store for runs. Big JSON stays server-side keyed by runId;
// tools return compact summaries + ids.
export class RunStore {
  readonly root: string;
  constructor(opts: RunStoreOptions = {}) {
    this.root = resolve(opts.root ?? join(process.cwd(), ".data", "runs"));
    mkdirSync(this.root, { recursive: true });
  }

  private dir(id: string): string { return join(this.root, id); }
  private file(id: string): string { return join(this.dir(id), "run.json"); }
  outDir(id: string): string {
    const d = join(this.dir(id), "out");
    mkdirSync(d, { recursive: true });
    return d;
  }
  workspaceDir(id: string): string {
    return join(this.root, "..", "workspaces", id);
  }

  create(source: string, appName?: string): RunRecord {
    const id = randomUUID();
    const rec: RunRecord = {
      id, source,
      appName: appName ?? deriveAppName(source, id),
      createdAt: new Date().toISOString(),
      stage: "created",
      ledger: [],
    };
    mkdirSync(this.dir(id), { recursive: true });
    this.save(rec);
    return rec;
  }

  list(): Array<{ id: string; appName: string; stage: RunStage; createdAt: string }> {
    if (!existsSync(this.root)) return [];
    const out: Array<{ id: string; appName: string; stage: RunStage; createdAt: string }> = [];
    for (const name of readdirSync(this.root)) {
      const f = join(this.root, name, "run.json");
      if (!existsSync(f)) continue;
      try {
        const r = JSON.parse(readFileSync(f, "utf8")) as RunRecord;
        out.push({ id: r.id, appName: r.appName, stage: r.stage, createdAt: r.createdAt });
      } catch { /* skip corrupted */ }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): RunRecord {
    const f = this.file(id);
    if (!existsSync(f)) throw new Error(`run not found: ${id}`);
    return JSON.parse(readFileSync(f, "utf8")) as RunRecord;
  }

  save(rec: RunRecord): void {
    mkdirSync(this.dir(rec.id), { recursive: true });
    writeFileSync(this.file(rec.id), JSON.stringify(rec, null, 2));
  }

  /** Rebuild a Ledger instance from stored entries so hash-chain verify() works after reload. */
  ledgerOf(rec: RunRecord): Ledger {
    const l = new Ledger();
    for (const e of rec.ledger) {
      l.append({ state: e.state, rule: e.rule, engine: e.engine, input: e.input, output: e.output, confidence: e.confidence });
    }
    return l;
  }

  /** Append one entry and persist. */
  appendLedger(rec: RunRecord, state: string, rule: string, input: unknown, output: unknown, engine: "rule" | "llm" | "human" = "rule"): void {
    const l = this.ledgerOf(rec);
    l.append({ state, rule, engine, input, output });
    rec.ledger = l.toJSON();
    this.save(rec);
  }

  requireStage(rec: RunRecord, need: RunStage, tool: string): void {
    if (!stageAtLeast(rec.stage, need)) {
      throw new StageError(
        `tool ${tool} needs stage>=${need}, current=${rec.stage}. Call ${nextTool(rec.stage)} first.`,
        need, rec.stage,
      );
    }
  }

  view(id: string): RunView {
    const r = this.get(id);
    const files = r.files?.map((f) => ({ path: f.path, kind: f.kind, bytes: Buffer.byteLength(f.content, "utf8") }));
    return {
      id: r.id, createdAt: r.createdAt, stage: r.stage, appName: r.appName, source: r.source,
      profile: r.profile, requirements: r.requirements,
      candidates: r.cost?.candidates, decision: r.decision,
      files, proof: r.proof,
      deliveries: r.deliveries,
      ledger: r.ledger,
    };
  }

  /** Guard a target path to prevent traversal / escaping cwd, and reject .git internals. */
  safeResolve(target: string): string {
    const abs = resolve(target);
    const cwd = resolve(process.cwd());
    if (!(abs === cwd || abs.startsWith(cwd + sep))) {
      throw new Error(`path escapes cwd: ${abs}`);
    }
    // No .git internal writes.
    const parts = abs.split(sep);
    if (parts.includes(".git")) throw new Error(`path inside .git rejected: ${abs}`);
    return abs;
  }

  writeFiles(id: string, files: GeneratedFile[]): void {
    const dir = this.outDir(id);
    for (const f of files) {
      const rel = f.path.replace(/^\/+/, "");
      const abs = resolve(join(dir, rel));
      if (!abs.startsWith(resolve(dir) + sep)) throw new Error(`file path escapes out/: ${f.path}`);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
    }
  }

  readOutFile(id: string, relPath: string): { path: string; bytes: number; content: string } {
    const dir = this.outDir(id);
    const cleaned = relPath.replace(/^\/+/, "");
    const abs = resolve(join(dir, cleaned));
    if (!abs.startsWith(resolve(dir) + sep)) throw new Error(`path escapes out/: ${relPath}`);
    if (!existsSync(abs)) throw new Error(`file not found: ${relPath}`);
    const content = readFileSync(abs, "utf8");
    return { path: relPath, bytes: Buffer.byteLength(content, "utf8"), content };
  }
}

function deriveAppName(source: string, id: string): string {
  const cleaned = source.replace(/\.git$/, "").replace(/\/+$/, "");
  const last = cleaned.split(/[\\/]/).filter(Boolean).pop();
  const slug = (last ?? id).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || id.slice(0, 8);
}

export function nextTool(stage: RunStage): string {
  switch (stage) {
    case "created": return "analyze_repo";
    case "profiled": return "next_questions/submit_answers";
    case "requirements": return "price_and_decide";
    case "priced": return "generate_artifacts";
    case "decided": return "generate_artifacts";
    case "generated": return "verify_artifacts";
    case "verified": return "deliver";
    case "delivered": return "get_run";
  }
}

// deterministic id for tests
export function hashSource(s: string): string { return createHash("sha1").update(s).digest("hex").slice(0, 12); }
