import { describe, expect, it } from "vitest";
import { allowedRegions, complianceReport, complianceCostDeltaPct } from "../src/residency.js";
import { buildCandidates } from "../src/candidates.js";
import { baseReq, fakePrices, serviceProfile } from "./helpers.js";

describe("residency", () => {
  it("EU residency excludes US and other non-EU regions", () => {
    const req = baseReq({ dataResidency: "eu", compliance: ["gdpr"] });
    const aws = allowedRegions(req, "aws").map((r) => r.id);
    expect(aws).toContain("eu-west-1");
    expect(aws).toContain("eu-central-1");
    expect(aws).not.toContain("us-east-1");
    expect(aws).not.toContain("ap-south-1");
    expect(aws).not.toContain("eu-west-2"); // London is uk geography
  });

  it("EU residency produces zero non-EU candidates", () => {
    const req = baseReq({ dataResidency: "eu", compliance: ["gdpr"] });
    const cands = buildCandidates(serviceProfile(), req, fakePrices());
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(c.meets.residency).toBe(true);
      expect(c.region.startsWith("us-")).toBe(false);
      expect(c.region.startsWith("eastus")).toBe(false);
    }
  });

  it("compliance report flags PII and non-EU egress under GDPR", () => {
    const req = baseReq({ dataResidency: "none", compliance: ["gdpr"], dataClasses: ["pii"] });
    const profile = serviceProfile({ pii: [{ signal: "email regex", file: "src/user.ts" }] });
    const cands = buildCandidates(profile, req, fakePrices());
    const usCand = cands.find((c) => c.region === "us-east-1");
    expect(usCand).toBeDefined();
    const findings = complianceReport(req, profile, usCand!);
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain("residency.egress");
    expect(rules).toContain("pii.in-code");
    expect(rules).toContain("encryption.rest");
  });

  it("cost delta pct increases with stronger compliance sets", () => {
    expect(complianceCostDeltaPct(baseReq({ compliance: [] }))).toBe(0);
    expect(complianceCostDeltaPct(baseReq({ compliance: ["gdpr"] }))).toBeGreaterThan(0);
    expect(complianceCostDeltaPct(baseReq({ compliance: ["hipaa", "pci"] }))).toBeGreaterThan(
      complianceCostDeltaPct(baseReq({ compliance: ["gdpr"] })),
    );
  });
});
