import { describe, expect, it } from "vitest";
import { buildCandidates, sizeContainer } from "../src/candidates.js";
import { decide } from "../src/score.js";
import { baseReq, fakePrices, serviceProfile, staticProfile } from "./helpers.js";

describe("candidates", () => {
  it("static site produces s3-cloudfront and gcs-cdn only", () => {
    const req = baseReq({ allowedProviders: ["aws", "gcp"] });
    const cands = buildCandidates(staticProfile(), req, fakePrices());
    const archs = new Set(cands.map((c) => c.architecture));
    expect(archs).toEqual(new Set(["aws-s3-cloudfront", "gcp-gcs-cdn"]));
  });

  it("needsSandbox excludes plain aws-lambda but keeps other compute", () => {
    const profile = serviceProfile({
      workloadType: "ai-agent",
      ai: { isAi: true, frameworks: [], modelProviders: [], vectorDbs: [], mcpServer: false, mcpClient: false, needsSandbox: true },
    });
    const cands = buildCandidates(profile, baseReq(), fakePrices());
    expect(cands.some((c) => c.architecture === "aws-lambda")).toBe(false);
    expect(cands.some((c) => c.architecture === "aws-ecs-fargate")).toBe(true);
    for (const c of cands) {
      expect(c.assumptions.some((a) => a.toLowerCase().includes("sandbox"))).toBe(true);
    }
  });

  it("uses pricebook SKUs when available and falls back with an assumption otherwise", () => {
    const prices = fakePrices([
      { provider: "aws", service: "fargate", description: "vCPU-hour Fargate", unit: "vCPU-hour", unitPrice: 0.041 },
      { provider: "aws", service: "fargate", description: "memory GB-hour", unit: "GB-hour", unitPrice: 0.0045 },
    ]);
    const cands = buildCandidates(serviceProfile(), baseReq({ allowedProviders: ["aws"] }), prices);
    const fargate = cands.find((c) => c.architecture === "aws-ecs-fargate" && c.region === "eu-west-1")!;
    const vcpu = fargate.lines.find((l) => l.label.includes("vCPU"))!;
    expect(vcpu.sku?.unitPrice).toBe(0.041);
    // A line without a matching SKU must produce an assumption note.
    expect(fargate.assumptions.some((a) => a.startsWith("Price SKU missing"))).toBe(true);
  });

  it("adds an LLM token line when llmTokensPerDay is set", () => {
    const req = baseReq({ llmTokensPerDay: 5_000_000, llmModel: "claude-3-5-haiku", allowedProviders: ["aws"] });
    const cands = buildCandidates(serviceProfile(), req, fakePrices());
    const c = cands[0]!;
    const llm = c.lines.find((l) => l.label === "LLM tokens");
    expect(llm).toBeDefined();
    expect(llm!.monthlyUsd).toBeGreaterThan(0);
  });

  it("sizes containers per documented model (1 vCPU ~ 50 rps, 1.5x headroom, min 2)", () => {
    // peakRps=200 -> 4380 vCPU-hours/month across 3x 2-vCPU instances.
    expect(sizeContainer(200)).toEqual({ instances: 3, vcpuPerInstance: 2, memGbPerInstance: 4 });
    const cands = buildCandidates(serviceProfile(), baseReq({ peakRps: 200, allowedProviders: ["aws"] }), fakePrices());
    const fargate = cands.find((c) => c.architecture === "aws-ecs-fargate")!;
    const vcpu = fargate.lines.find((l) => l.label.includes("vCPU"))!;
    const mem = fargate.lines.find((l) => l.label.includes("memory"))!;
    expect(vcpu.quantity).toBe(4380);
    expect(mem.quantity).toBe(8760);
  });

  it("flags implausible unit prices and decide() rejects them", () => {
    // Force a wildly-off price on the Fargate vCPU line (bound is [0.005, 0.15]).
    const prices = fakePrices([
      { provider: "aws", service: "fargate", description: "Fargate vCPU EU", unit: "hours", unitPrice: 9.99 },
    ]);
    const cands = buildCandidates(serviceProfile(), baseReq({ peakRps: 200, allowedProviders: ["aws"] }), prices);
    const fargate = cands.find((c) => c.architecture === "aws-ecs-fargate")!;
    expect(fargate.assumptions.some((a) => a.startsWith("price-sanity-failed:"))).toBe(true);
    const dec = decide(cands, baseReq({ peakRps: 200, allowedProviders: ["aws"] }));
    const rej = dec.rejected.find((r) => r.id === fargate.id);
    expect(rej?.reason).toMatch(/price-sanity/);
  });

  it("decide() keeps candidates that pass all sanity checks", () => {
    const cands = buildCandidates(serviceProfile(), baseReq({ peakRps: 200, allowedProviders: ["aws"] }), fakePrices());
    const dec = decide(cands, baseReq({ peakRps: 200, allowedProviders: ["aws"] }));
    // At least one aws candidate survives without a sanity rejection.
    expect(dec.chosenId).toMatch(/^aws-/);
    expect(dec.rejected.every((r) => !r.reason.includes("price-sanity"))).toBe(true);
  });

  it("candidate order is deterministic across runs", () => {
    const a = buildCandidates(serviceProfile(), baseReq(), fakePrices()).map((c) => c.id);
    const b = buildCandidates(serviceProfile(), baseReq(), fakePrices()).map((c) => c.id);
    expect(a).toEqual(b);
  });
});
