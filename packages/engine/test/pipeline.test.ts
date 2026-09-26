import { describe, it, expect } from "vitest";
import type {
  CostModel,
  Decision,
  GeneratedFile,
  ProofReport,
  Requirements,
  RepoProfile,
} from "@smc/contracts";
import { runPipeline, type PipelineDeps } from "@smc/engine";

const profile: RepoProfile = {
  source: { kind: "path", ref: "." },
  workloadType: "service",
  languages: ["ts"],
  packageManager: "pnpm",
  services: [],
  dockerable: true,
  hasDockerfile: true,
  hasCompose: false,
  hasHelm: false,
  hasTerraform: false,
  hasK8sManifests: false,
  ci: "none",
  datastores: [],
  ai: { isAi: false, frameworks: [], modelProviders: [], vectorDbs: [], mcpServer: false, mcpClient: false, needsSandbox: false },
  envVars: [],
  pii: [],
  evidence: [],
};

const requirements: Requirements = {
  latencyP95Ms: 200,
  availabilityTarget: 0.99,
  userRegions: ["us-east"],
  peakRps: 10,
  dataResidency: "none",
  dataClasses: ["none"],
  compliance: [],
  allowedProviders: ["aws"],
};

const cost: CostModel = { candidates: [], generatedAt: new Date().toISOString() };
const decision: Decision = { chosenId: "c1", ranked: [], rejected: [], rationale: ["ok"] };
const files: GeneratedFile[] = [{ path: "Dockerfile", content: "FROM node:20", kind: "dockerfile" }];
const report: ProofReport = { checks: [], verdict: "verified" };

const makeDeps = (over: Partial<PipelineDeps> = {}): PipelineDeps => ({
  ingest: async () => ({ workspace: "/tmp/ws" }),
  detect: async () => profile,
  askUser: async () => requirements,
  cost: async () => cost,
  decide: async () => decision,
  generate: async () => files,
  verify: async () => report,
  deliver: async () => ({ url: "https://demo.example/xyz" }),
  ...over,
});

describe("pipeline", () => {
  it("happy path with fakes runs to DONE via APPROVE", async () => {
    const result = await runPipeline(makeDeps(), { source: { kind: "path", ref: "." } }, {
      onReview: (actor) => actor.send({ type: "APPROVE" }),
    });
    expect(result.status).toBe("DONE");
    expect(result.context.delivery?.url).toContain("https://");
    // Ledger contains one human APPROVE entry
    const entries = result.context.ledger.toJSON();
    expect(entries.some((e) => e.state === "REVIEW" && e.engine === "human")).toBe(true);
    expect(result.context.ledger.verify().ok).toBe(true);
  });

  it("REJECT loops back to DECIDE and never delivers without APPROVE", async () => {
    let decideCalls = 0;
    let delivered = false;
    const deps = makeDeps({
      decide: async () => {
        decideCalls++;
        return decision;
      },
      deliver: async () => {
        delivered = true;
        return { url: "no" };
      },
    });
    let rejectedOnce = false;
    const result = await runPipeline(deps, { source: { kind: "path", ref: "." } }, {
      onReview: (actor) => {
        if (!rejectedOnce) {
          rejectedOnce = true;
          actor.send({ type: "REJECT", reason: "try again" });
        } else {
          actor.send({ type: "APPROVE" });
        }
      },
    });
    expect(result.status).toBe("DONE");
    expect(decideCalls).toBe(2);
    expect(delivered).toBe(true);
  });

  it("cannot reach DELIVER without APPROVE (times out at REVIEW)", async () => {
    let delivered = false;
    const deps = makeDeps({
      deliver: async () => {
        delivered = true;
        return { url: "x" };
      },
    });
    const done = runPipeline(deps, { source: { kind: "path", ref: "." } });
    const race = await Promise.race([
      done,
      new Promise<"pending">((r) => setTimeout(() => r("pending"), 100)),
    ]);
    expect(race).toBe("pending");
    expect(delivered).toBe(false);
  });

  it("FAILED on service error records the error to the ledger", async () => {
    const deps = makeDeps({
      detect: async () => {
        throw new Error("boom");
      },
    });
    const result = await runPipeline(deps, { source: { kind: "path", ref: "." } });
    expect(result.status).toBe("FAILED");
    const entries = result.context.ledger.toJSON();
    expect(entries.some((e) => e.state === "FAILED")).toBe(true);
  });
});
