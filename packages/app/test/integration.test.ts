import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/analyze.js";

const cacheReady =
  existsSync(join(process.cwd(), ".cache/pricing/aws/fargate/eu-west-1.json")) &&
  existsSync(join(process.cwd(), ".cache/pricing/gcp/compute/europe-west1.json"));

const gate = process.env.LIVE === "1" || cacheReady;
const d = gate ? describe : describe.skip;

d("analyze() on fixtures/node-api (LIVE=1 or cache present)", () => {
  it("prices EU node-api workload sensibly and stays close across candidates", async () => {
    const req = {
      latencyP95Ms: 300, availabilityTarget: 0.999, userRegions: ["eu"], peakRps: 200, avgRps: 40,
      dataResidency: "eu" as const, dataClasses: ["pii" as const], compliance: ["gdpr" as const],
      allowedProviders: ["aws" as const, "gcp" as const], monthlyBudgetUsd: 100_000,
    };
    const { candidates } = await analyze("fixtures/node-api", req);
    const pick = (id: string) => candidates.find((c) => c.id === id);
    const fargate = pick("aws-ecs-fargate:eu-west-1")!;
    const cloudRun = pick("gcp-cloud-run:europe-west1")!;
    const gke = pick("gcp-gke-autopilot:europe-west1")!;
    for (const c of [fargate, cloudRun, gke]) {
      expect(c, `missing ${JSON.stringify(candidates.map((x) => x.id))}`).toBeDefined();
      // No line falls back unless we admit it in an assumption.
      const fallbackLines = c.lines.filter((l) => !l.sku && l.label !== "LLM tokens");
      const admitted = c.assumptions.filter((a) => a.startsWith("Price SKU missing")).length;
      expect(fallbackLines.length, `${c.id} fallbacks=${fallbackLines.map((l) => l.label).join(",")}`).toBe(admitted);
      // Sanity guard did not fire on any line for these standard workloads.
      expect(c.assumptions.filter((a) => a.startsWith("price-sanity-failed:"))).toEqual([]);
      // Total in a defensible range (bulk of cost is 5 TB egress at ~$0.09/GB ≈ $460).
      expect(c.monthlyUsd).toBeGreaterThan(100);
      expect(c.monthlyUsd).toBeLessThan(1500);
    }
    // Cheapest should not be absurdly lower than the others.
    const cheapest = Math.min(fargate.monthlyUsd, cloudRun.monthlyUsd, gke.monthlyUsd);
    const dearest = Math.max(fargate.monthlyUsd, cloudRun.monthlyUsd, gke.monthlyUsd);
    expect(dearest / cheapest).toBeLessThan(3);
  });
});
