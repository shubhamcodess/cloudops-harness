import { describe, expect, it } from "vitest";
import { buildCandidates } from "../src/candidates.js";
import { decide } from "../src/score.js";
import { baseReq, fakePrices, serviceProfile } from "./helpers.js";

describe("score.decide", () => {
  it("is deterministic (same input -> identical decision)", () => {
    const req = baseReq({ allowedProviders: ["aws", "gcp"] });
    const cands = buildCandidates(serviceProfile(), req, fakePrices());
    const a = decide(cands, req);
    const b = decide(cands, req);
    expect(a).toEqual(b);
    expect(a.chosenId).toBeTruthy();
  });

  it("rejects candidates that exceed the budget", () => {
    const req = baseReq({ monthlyBudgetUsd: 1 });
    const cands = buildCandidates(serviceProfile(), req, fakePrices());
    const d = decide(cands, req);
    expect(d.chosenId).toBe("");
    expect(d.rejected.length).toBeGreaterThan(0);
    expect(d.rejected.every((r) => /budget/.test(r.reason))).toBe(true);
  });

  it("ranks by monthlyUsd ascending", () => {
    const req = baseReq();
    const cands = buildCandidates(serviceProfile(), req, fakePrices());
    const d = decide(cands, req);
    for (let i = 1; i < d.ranked.length; i++) {
      expect(d.ranked[i]!.monthlyUsd).toBeGreaterThanOrEqual(d.ranked[i - 1]!.monthlyUsd);
    }
    // Chosen must be at the minimum monthlyUsd of the eligible set.
    const eligibleMin = Math.min(
      ...cands
        .filter((c) => c.meets.residency && c.meets.latency && c.meets.availability && c.meets.budget)
        .map((c) => c.monthlyUsd),
    );
    const chosen = cands.find((c) => c.id === d.chosenId)!;
    expect(chosen.monthlyUsd).toBe(eligibleMin);
  });

  it("computes savings vs existing deployment", () => {
    const req = baseReq({
      existing: { provider: "aws", region: "us-east-1", monthlyCostUsd: 5000, summary: "legacy ec2" },
    });
    const cands = buildCandidates(serviceProfile(), req, fakePrices());
    const d = decide(cands, req);
    expect(d.savingsVsExistingUsd).toBeDefined();
    const chosen = cands.find((c) => c.id === d.chosenId)!;
    expect(d.savingsVsExistingUsd).toBe(Math.round((5000 - chosen.monthlyUsd) * 100) / 100);
  });

  it("moderate budget partially rejects and cites budget in reason", () => {
    const cands = buildCandidates(serviceProfile(), baseReq(), fakePrices());
    const median = [...cands].map((c) => c.monthlyUsd).sort((a, b) => a - b)[Math.floor(cands.length / 2)]!;
    const req = baseReq({ monthlyBudgetUsd: median });
    const d = decide(buildCandidates(serviceProfile(), req, fakePrices()), req);
    expect(d.rejected.length).toBeGreaterThan(0);
    expect(d.rejected.some((r) => /budget/.test(r.reason))).toBe(true);
    expect(d.chosenId).toBeTruthy();
  });
});
