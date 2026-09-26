import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { GeneratedFile, ProofReport } from "@smc/contracts";
import { DockerSandbox, type RunResult, type Sandbox } from "./sandbox";

type CheckResult = ProofReport["checks"][number];

const IMAGES = {
  tofu: "ghcr.io/opentofu/opentofu:latest",
  helm: "alpine/helm:latest",
  conftest: "openpolicyagent/conftest:latest",
  gitleaks: "zricethezav/gitleaks:latest",
};

export interface VerifyOptions {
  sandbox?: Sandbox;
  /** Apply AWS Terraform to a local Floci emulator (needs `floci start`). */
  floci?: boolean;
  flociEndpoint?: string;
}

const tail = (r: RunResult) => (r.stdout + r.stderr).trim().split("\n").slice(-8).join("\n");
const mk = (name: string, r: RunResult, okMsg: string): CheckResult => ({
  name,
  status: r.code === 0 ? "pass" : "fail",
  evidence: r.code === 0 ? okMsg : tail(r),
  durationMs: r.durationMs,
});

export function writeFiles(files: GeneratedFile[], dir: string) {
  for (const f of files) {
    const p = join(dir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
  }
}

export async function verifyArtifacts(files: GeneratedFile[], opts: VerifyOptions = {}): Promise<ProofReport> {
  const sb = opts.sandbox ?? new DockerSandbox();
  const dir = mkdtempSync(join(tmpdir(), "smc-verify-"));
  const checks: CheckResult[] = [];
  try {
    writeFiles(files, dir);
    const tfDirs = [...new Set(files.filter((f) => f.kind === "terraform").map((f) => dirname(f.path)))];
    const chart = files.find((f) => f.path.endsWith("Chart.yaml"));
    const policies = files.some((f) => f.kind === "policy");

    for (const d of tfDirs) {
      const r = await sb.run({
        image: IMAGES.tofu, entrypoint: "sh", dir, network: true, timeoutMs: 300_000,
        cmd: ["-c", `tofu -chdir=${d} init -backend=false -input=false -no-color >/dev/null && tofu -chdir=${d} validate -no-color`],
      });
      checks.push(mk(`tofu validate (${d})`, r, "configuration is valid"));
    }

    if (chart) {
      const c = dirname(chart.path);
      const lint = await sb.run({ image: IMAGES.helm, dir, cmd: ["lint", c] });
      checks.push(mk("helm lint", lint, "chart lints clean"));
      const tpl = await sb.run({ image: IMAGES.helm, entrypoint: "sh", dir, cmd: ["-c", `helm template smc ${c} -f ${c}/values-prod.yaml > .rendered.yaml`] });
      checks.push(mk("helm template", tpl, "chart renders with prod values"));
      if (policies && tpl.code === 0) {
        const cf = await sb.run({ image: IMAGES.conftest, dir, cmd: ["test", ".rendered.yaml", "-p", "policy", "--namespace", "helm", "--no-color"] });
        checks.push(mk("policy (conftest on rendered chart)", cf, "no policy violations"));
      }
    }

    const leaks = await sb.run({ image: IMAGES.gitleaks, dir, cmd: ["detect", "--no-git", "--source", "/work", "--no-banner", "--redact"] });
    checks.push(mk("secret scan (gitleaks)", leaks, "no secrets in generated files"));

    const awsDir = tfDirs.find((d) => d.includes("aws"));
    if (opts.floci && awsDir) {
      const ep = (opts.flociEndpoint ?? "http://localhost:4566").replace("localhost", "host.docker.internal");
      const ov = join(dir, awsDir, "floci_override.tf.example");
      if (existsSync(ov)) {
        writeFileSync(join(dir, awsDir, "floci_override.tf"), readFileSync(ov, "utf8").replaceAll("http://localhost:4566", ep));
        const r = await sb.run({
          image: IMAGES.tofu, entrypoint: "sh", dir, network: true, timeoutMs: 420_000,
          env: { AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_REGION: "eu-west-1" },
          cmd: ["-c", `tofu -chdir=${awsDir} init -backend=false -input=false -no-color >/dev/null && tofu -chdir=${awsDir} apply -auto-approve -input=false -no-color -var-file=floci.tfvars -var app=smc${Date.now().toString(36)}`],
        });
        checks.push(mk("apply to Floci emulator", r, "applied cleanly to local AWS emulator"));
      }
    } else {
      checks.push({ name: "apply to Floci emulator", status: "skipped", evidence: opts.floci ? "no AWS terraform" : "not requested" });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const failed = checks.some((c) => c.status === "fail");
  const skipped = checks.some((c) => c.status === "skipped");
  return { checks, verdict: failed ? "failed" : skipped ? "partial" : "verified" };
}
