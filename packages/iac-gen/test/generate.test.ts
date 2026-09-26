import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { generateArtifacts } from "@smc/iac-gen";
import {
  nodeProfile,
  staticProfile,
  pyProfile,
  reqs,
  awsEcsCandidate,
  awsLambdaCandidate,
  awsSiteCandidate,
  gcpRunCandidate,
  gcpSiteCandidate,
  secrets,
} from "./fixtures.js";

const has = (bin: string): boolean => {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" });
  return r.status === 0 && !!r.stdout.trim();
};

const writeAll = (root: string, files: { path: string; content: string }[]) => {
  for (const f of files) {
    const abs = join(root, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
  }
};

const tfDirOf = (arch: string, provider: string) =>
  `terraform/${provider}-${arch.replace(/^(aws|gcp)-/, "")}`;

describe("generateArtifacts: shape", () => {
  it("includes dockerfile, terraform, helm, ci, policy files", () => {
    const out = generateArtifacts({
      appName: "My App",
      profile: nodeProfile(),
      requirements: reqs(),
      candidate: awsEcsCandidate(),
      secrets: secrets(),
    });
    const kinds = new Set(out.map((f) => f.kind));
    for (const k of ["dockerfile", "terraform", "helm", "ci", "policy"]) {
      expect(kinds.has(k as any)).toBe(true);
    }
    expect(out.some((f) => f.path === "Dockerfile")).toBe(true);
    expect(out.some((f) => f.path === ".dockerignore")).toBe(true);
    expect(out.some((f) => f.path.endsWith("versions.tf"))).toBe(true);
    expect(out.some((f) => f.path.endsWith("main.tf"))).toBe(true);
    expect(out.some((f) => f.path === "charts/my-app/Chart.yaml")).toBe(true);
    expect(out.some((f) => f.path === ".github/workflows/deploy.yml")).toBe(true);
    expect(out.some((f) => f.path === "policy/iac.rego")).toBe(true);
  });

  it("is deterministic and sorted", () => {
    const args = {
      appName: "demo",
      profile: nodeProfile(),
      requirements: reqs(),
      candidate: awsEcsCandidate(),
      secrets: secrets(),
    };
    const a = generateArtifacts(args);
    const b = generateArtifacts(args);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const paths = a.map((f) => f.path);
    expect(paths).toEqual([...paths].sort());
  });

  it("dockerfile chooses nginx for static, python base for python", () => {
    const s = generateArtifacts({
      appName: "site",
      profile: staticProfile(),
      requirements: reqs(),
      candidate: awsSiteCandidate(),
      secrets: secrets(),
    });
    const sd = s.find((f) => f.path === "Dockerfile")!;
    expect(sd.content).toMatch(/nginx/);

    const p = generateArtifacts({
      appName: "py",
      profile: pyProfile(),
      requirements: reqs(),
      candidate: awsEcsCandidate(),
      secrets: secrets(),
    });
    const pd = p.find((f) => f.path === "Dockerfile")!;
    expect(pd.content).toMatch(/python:3\.12/);
    expect(pd.content).toMatch(/USER app/);
  });

  it("terraform includes RDS when postgres in datastores; not when absent", () => {
    const withPg = generateArtifacts({
      appName: "app",
      profile: nodeProfile({ datastores: ["postgres"] }),
      requirements: reqs(),
      candidate: awsEcsCandidate(),
      secrets: secrets(),
    });
    const withoutPg = generateArtifacts({
      appName: "app",
      profile: nodeProfile({ datastores: [] }),
      requirements: reqs(),
      candidate: awsEcsCandidate(),
      secrets: secrets(),
    });
    const mainA = withPg.find((f) => f.path.endsWith("main.tf"))!.content;
    const mainB = withoutPg.find((f) => f.path.endsWith("main.tf"))!.content;
    expect(mainA).toMatch(/aws_db_instance/);
    expect(mainB).not.toMatch(/aws_db_instance/);
  });

  it("includes floci override file and secret refs (never values)", () => {
    const out = generateArtifacts({
      appName: "app",
      profile: nodeProfile(),
      requirements: reqs(),
      candidate: awsEcsCandidate(),
      secrets: secrets(),
    });
    expect(out.some((f) => f.path.endsWith("floci_override.tf.example"))).toBe(true);
    const override = out.find((f) => f.path.endsWith("floci_override.tf.example"))!.content;
    expect(override).toMatch(/localhost:4566/);
    const main = out.find((f) => f.path.endsWith("main.tf"))!.content;
    expect(main).toMatch(/aws_secretsmanager_secret/);
    expect(main).not.toMatch(/DATABASE_URL\s*=\s*"[^\$]/);
  });
});

describe("terraform validate", () => {
  const tofuOk = has("tofu");
  for (const cand of [awsEcsCandidate(), awsLambdaCandidate(), awsSiteCandidate(), gcpRunCandidate(), gcpSiteCandidate()]) {
    it.skipIf(!tofuOk)(`tofu validate ${cand.provider}/${cand.architecture}`, () => {
      const out = generateArtifacts({
        appName: "app",
        profile: nodeProfile(),
        requirements: reqs(),
        candidate: cand,
        secrets: secrets(),
      });
      const root = mkdtempSync(join(tmpdir(), "iac-tf-"));
      writeAll(root, out);
      const dir = join(root, tfDirOf(cand.architecture, cand.provider));
      execFileSync("tofu", ["init", "-backend=false", "-input=false", "-no-color"], { cwd: dir, stdio: "pipe" });
      execFileSync("tofu", ["validate", "-no-color"], { cwd: dir, stdio: "pipe" });
    }, 120000);
  }
});

describe("helm lint + template", () => {
  const helmOk = has("helm");
  it.skipIf(!helmOk)("passes helm lint and template", () => {
    const out = generateArtifacts({
      appName: "demo",
      profile: nodeProfile(),
      requirements: reqs(),
      candidate: awsEcsCandidate(),
      secrets: secrets(),
    });
    const root = mkdtempSync(join(tmpdir(), "iac-helm-"));
    writeAll(root, out);
    const chart = join(root, "charts/demo");
    expect(existsSync(join(chart, "Chart.yaml"))).toBe(true);
    execFileSync("helm", ["lint", chart], { stdio: "pipe" });
    execFileSync("helm", ["template", "demo", chart], { stdio: "pipe" });
  }, 60000);
});

describe("conftest policy", () => {
  const okBins = has("conftest") && has("helm");
  it.skipIf(!okBins)("conftest passes on rendered helm output", () => {
    const out = generateArtifacts({
      appName: "demo",
      profile: nodeProfile(),
      requirements: reqs(),
      candidate: awsEcsCandidate(),
      secrets: secrets(),
    });
    const root = mkdtempSync(join(tmpdir(), "iac-conf-"));
    writeAll(root, out);
    const chart = join(root, "charts/demo");
    const rendered = execFileSync("helm", ["template", "demo", chart], { encoding: "utf8" });
    const renderedPath = join(root, "rendered.yaml");
    writeFileSync(renderedPath, rendered);
    const r = spawnSync("conftest", ["test", "--policy", join(root, "policy"), "--namespace", "smc.helm", renderedPath], {
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`conftest failed: ${r.stdout}\n${r.stderr}`);
  }, 60000);
});
