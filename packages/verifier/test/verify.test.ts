import { describe, expect, it } from "vitest";
import { generateArtifacts } from "@smc/iac-gen";
import * as f from "../../iac-gen/test/fixtures";
import { verifyArtifacts } from "../src/verify";

const docker = await import("node:child_process").then((m) => m.spawnSync("docker", ["info"]).status === 0);

describe.skipIf(!docker)("verifyArtifacts", () => {
  it("proves generated AWS artifacts in containers", async () => {
    const files = generateArtifacts({ profile: f.nodeProfile(), requirements: f.reqs(), candidate: f.awsEcsCandidate(), secrets: (f.secrets as any)(), appName: "demo" });
    const report = await verifyArtifacts(files);
    for (const c of report.checks) console.log(c.status.padEnd(8), c.name, c.status === "fail" ? c.evidence : "");
    expect(report.checks.find((c) => c.name.startsWith("tofu validate"))?.status).toBe("pass");
    expect(report.checks.find((c) => c.name === "helm lint")?.status).toBe("pass");
    expect(report.verdict).not.toBe("failed");
  }, 600_000);
});
