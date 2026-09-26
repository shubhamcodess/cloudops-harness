import { describe, it, expect } from "vitest";
import type { RepoProfile } from "@smc/contracts";
import { applyAnswers, planQuestions } from "@smc/engine";

const baseProfile = (over: Partial<RepoProfile> = {}): RepoProfile => ({
  source: { kind: "path", ref: "." },
  workloadType: "service",
  languages: ["ts"],
  packageManager: "pnpm",
  services: [],
  dockerable: true,
  hasDockerfile: false,
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
  ...over,
});

describe("planQuestions", () => {
  it("only asks about missing Requirements fields", () => {
    const qs = planQuestions(baseProfile(), { peakRps: 100, latencyP95Ms: 200 });
    const fields = qs.map((q) => q.field);
    expect(fields).not.toContain("peakRps");
    expect(fields).not.toContain("latencyP95Ms");
    expect(fields).toContain("dataResidency");
  });

  it("puts residency and availability before latency and rps", () => {
    const qs = planQuestions(baseProfile(), {});
    const order = qs.map((q) => q.field);
    expect(order.indexOf("dataResidency")).toBeLessThan(order.indexOf("latencyP95Ms"));
    expect(order.indexOf("availabilityTarget")).toBeLessThan(order.indexOf("peakRps"));
    expect(order.indexOf("peakRps")).toBeLessThan(order.indexOf("monthlyBudgetUsd"));
  });

  it("uses static-site defaults for relaxed latency", () => {
    const qs = planQuestions(baseProfile({ workloadType: "static-site" }), {});
    const latency = qs.find((q) => q.field === "latencyP95Ms")!;
    expect(latency.default).toBe(500);
  });

  it("asks LLM questions only when profile.ai.isAi", () => {
    const nonAi = planQuestions(baseProfile(), {}).map((q) => q.field);
    expect(nonAi).not.toContain("llmTokensPerDay");
    expect(nonAi).not.toContain("llmModel");

    const ai = planQuestions(
      baseProfile({
        workloadType: "ai-agent",
        ai: { isAi: true, frameworks: ["langchain"], modelProviders: ["anthropic"], vectorDbs: [], mcpServer: false, mcpClient: false, needsSandbox: true },
      }),
      {},
    ).map((q) => q.field);
    expect(ai).toContain("llmTokensPerDay");
    expect(ai).toContain("llmModel");
  });

  it("returns empty when every Requirements field is provided", () => {
    const filled: Parameters<typeof planQuestions>[1] = {
      latencyP95Ms: 100,
      availabilityTarget: 0.99,
      userRegions: ["us-east"],
      peakRps: 10,
      avgRps: 3,
      monthlyBudgetUsd: 500,
      dataResidency: "none",
      dataClasses: ["none"],
      compliance: [],
      allowedProviders: ["aws"],
      existing: { provider: "aws", region: "us-east-1", monthlyCostUsd: 200, summary: "" },
    };
    expect(planQuestions(baseProfile(), filled)).toHaveLength(0);
  });
});

describe("applyAnswers", () => {
  it("validates with Requirements.safeParse", () => {
    const ok = applyAnswers(
      {},
      {
        latencyP95Ms: 200,
        availabilityTarget: 0.99,
        userRegions: ["us-east"],
        peakRps: 5,
        dataResidency: "none",
        dataClasses: ["none"],
        compliance: [],
        allowedProviders: ["aws"],
      },
    );
    expect(ok.ok).toBe(true);
  });
  it("rejects invalid answers", () => {
    const bad = applyAnswers({}, { latencyP95Ms: -1 } as never);
    expect(bad.ok).toBe(false);
  });
});
