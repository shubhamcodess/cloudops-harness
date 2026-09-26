import type { Candidate, Decision, GeneratedFile, ProofReport, RepoProfile, Requirements, SecretsManifest } from "@smc/contracts";

export interface HandbookInput {
  profile: RepoProfile;
  requirements: Requirements;
  candidate: Candidate;
  decision: Decision;
  proof?: ProofReport;
  secrets: SecretsManifest;
  appName: string;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

function deploySteps(c: Candidate, app: string): { cmds: string[]; verify: string[]; rollback: string[]; scale: string } {
  const tf = ["cd infra", "tofu init", `tofu plan -out=${app}.plan`, `tofu apply ${app}.plan`];
  switch (c.architecture) {
    case "aws-eks":
    case "gcp-gke-autopilot":
      return {
        cmds: [...tf, `helm upgrade --install ${app} ./helm/${app} --namespace ${app} --create-namespace -f helm/${app}/values-prod.yaml`],
        verify: [`kubectl -n ${app} rollout status deploy/${app}`, `kubectl -n ${app} get pods`],
        rollback: [`helm -n ${app} history ${app}`, `helm -n ${app} rollback ${app} <REVISION>`],
        scale: `Adjust the HPA in helm/${app}/values-prod.yaml (minReplicas, maxReplicas) and re-run helm upgrade.`,
      };
    case "aws-lambda":
      return {
        cmds: tf,
        verify: [`aws lambda get-function --function-name ${app}`, `aws lambda invoke --function-name ${app} /dev/stdout`],
        rollback: [`aws lambda update-alias --function-name ${app} --name live --function-version <PREVIOUS_VERSION>`],
        scale: "Set reserved or provisioned concurrency in the Terraform variables and apply.",
      };
    case "aws-ecs-fargate":
      return {
        cmds: tf,
        verify: [`aws ecs describe-services --cluster ${app} --services ${app}`],
        rollback: [`aws ecs update-service --cluster ${app} --service ${app} --task-definition <PREVIOUS_TASK_DEF>`],
        scale: "Change desired_count and the autoscaling min/max in the Terraform variables and apply.",
      };
    case "gcp-cloud-run":
      return {
        cmds: tf,
        verify: [`gcloud run services describe ${app} --region ${c.region}`],
        rollback: [`gcloud run services update-traffic ${app} --region ${c.region} --to-revisions <PREVIOUS_REVISION>=100`],
        scale: "Change min/max instances in the Terraform variables and apply.",
      };
    case "azure-container-apps":
      return {
        cmds: tf,
        verify: [`az containerapp show --name ${app} --resource-group ${app}`],
        rollback: [`az containerapp revision activate --name ${app} --resource-group ${app} --revision <PREVIOUS_REVISION>`],
        scale: "Change min/max replicas in the Terraform variables and apply.",
      };
    case "aws-s3-cloudfront":
    case "gcp-gcs-cdn":
      return {
        cmds: [...tf, "# then upload the build output with the sync command in infra/README or CI"],
        verify: ["curl -sI https://<SITE_DOMAIN>/ | head -n 1"],
        rollback: ["Re-upload the previous build artifact and invalidate the CDN cache."],
        scale: "Nothing to do. The CDN scales itself.",
      };
    default:
      return {
        cmds: tf,
        verify: ["curl -sf https://<APP_DOMAIN>/health"],
        rollback: ["Re-apply the previous known-good image tag and run tofu apply."],
        scale: "Change instance count or type in the Terraform variables and apply.",
      };
  }
}

function storeCmd(store: SecretsManifest["store"], name: string): string {
  if (store === "aws-secrets-manager") return `aws secretsmanager create-secret --name ${name} --secret-string "$VALUE"`;
  if (store === "gcp-secret-manager") return `printf %s "$VALUE" | gcloud secrets create ${name} --data-file=-`;
  return `vault kv put secret/${name} value="$VALUE"`;
}

export function generateHandbook(input: HandbookInput): GeneratedFile[] {
  const { profile, requirements: r, candidate: c, decision, proof, secrets, appName } = input;
  const s = deploySteps(c, appName);
  const L: string[] = [];
  const add = (...x: string[]) => L.push(...x);
  const fence = (cmds: string[]) => add("```sh", ...cmds, "```", "");

  add(`# ${appName} deployment handbook`, "");
  add("## Decision summary", "", `Chosen: **${c.architecture}** on ${c.provider} in ${c.region} (${c.id}), about **${usd(c.monthlyUsd)}/month**.`, "");
  for (const x of decision.rationale) add(`- ${x}`);
  if (decision.savingsVsExistingUsd !== undefined) add(`- Savings versus the current setup: ${usd(decision.savingsVsExistingUsd)}/month.`);
  add("", "Rejected alternatives:", "");
  if (decision.rejected.length === 0) add("- None.");
  for (const x of decision.rejected) add(`- ${x.id}: ${x.reason}`);
  add("");

  add("## Prerequisites and access", "", "- Tofu (or Terraform) 1.6+, Docker, and git.");
  if (c.provider === "aws") add("- AWS CLI, signed in to the target account with permission to create IAM, networking, and compute resources.");
  if (c.provider === "gcp") add("- gcloud CLI, signed in to the target project with Editor plus Secret Manager Admin.");
  if (c.provider === "azure") add("- Azure CLI, signed in to the target subscription with Contributor.");
  if (c.architecture.endsWith("eks") || c.architecture.endsWith("gke-autopilot")) add("- kubectl and helm 3.");
  add("- Access to the container registry the pipeline pushes to.", "");

  add("## Environments", "", "- dev: sandbox, mock secrets only, safe to destroy.", "- staging: real infrastructure, non-production data.", "- prod: real data, changes require approval.");
  const perEnv = secrets.config.filter((x) => x.perEnv).map((x) => x.name);
  if (perEnv.length) add("", `Set these per environment: ${perEnv.join(", ")}.`);
  add("");

  add("## Deploy", "", "1. Build and push the image (CI does this on merge to main).", "2. Run:", "");
  fence(s.cmds);
  add("3. Review the plan output before applying. Apply only if it matches expectations.", "");

  add("## Verify", "");
  fence(s.verify);
  if (proof) {
    add(`Pre-deploy proof verdict: **${proof.verdict}**.`, "");
    for (const k of proof.checks) add(`- ${k.name}: ${k.status}`);
    add("");
  }

  add("## Rollback", "");
  fence(s.rollback);
  add("If infrastructure changed, revert the commit and run `tofu apply` again.", "");

  add("## Secrets", "", `Store: ${secrets.store}. Never commit values.`, "");
  if (secrets.secrets.length === 0) add("No secrets detected.");
  else {
    add("| Name | Rotation | Injection |", "|---|---|---|");
    for (const x of secrets.secrets) add(`| ${x.name} | ${x.rotationDays} days | ${x.injection} |`);
    add("", "Create (value comes from your shell, not this file):", "");
    fence(secrets.secrets.map((x) => storeCmd(secrets.store, x.name)));
    add("Rotate: write a new version to the store, redeploy or wait for the sync, verify, then revoke the old credential.");
  }
  add("");

  add("## Scaling", "", s.scale, `Design peak: ${r.peakRps} rps, p95 target ${r.latencyP95Ms} ms.`, "");

  add("## Cost monitoring", "", `Priced monthly estimate: **${usd(c.monthlyUsd)}**.`, "", "| Line | Quantity | Monthly |", "|---|---|---|");
  for (const l of c.lines) add(`| ${l.label} | ${l.quantity} ${l.unit} | ${usd(l.monthlyUsd)} |`);
  add("");
  const budget = r.monthlyBudgetUsd ?? Math.ceil(c.monthlyUsd * 1.25);
  add(`Set a budget of ${usd(budget)}/month with alerts at 50%, 80%, and 100%. Review the bill weekly for the first month.`, "");
  if (c.assumptions.length) add("Assumptions:", "", ...c.assumptions.map((a) => `- ${a}`), "");

  add("## Incident runbook", "", "1. Check the health endpoint and the latest deploy time.", "2. If the incident started after a deploy, roll back first, investigate second.", "3. Check logs and metrics for the failing component.", "4. If data may be exposed, stop and escalate to the owner. Rotate the affected secrets.", "5. Write a short blameless note once resolved.", "");

  add("## GDPR and residency checklist", "");
  const region = r.dataResidency === "none" ? "no residency constraint" : `data stays in ${r.dataResidency.toUpperCase()}`;
  add(`- [ ] Residency: ${region}; deployed region is ${c.region}.`);
  add(`- [ ] Data classes handled: ${r.dataClasses.join(", ")}.`);
  if (r.dataClasses.includes("pii") || r.dataClasses.includes("special-category") || r.compliance.includes("gdpr")) {
    add("- [ ] Records of processing and a lawful basis are documented.", "- [ ] Data subject access and deletion requests have an owner and a process.", "- [ ] Backups and logs stay in the same region.", "- [ ] Processor agreements are signed with the cloud provider.");
  }
  if (r.dataClasses.includes("special-category")) add("- [ ] Explicit consent or another Article 9 basis is recorded.");
  if (r.dataClasses.includes("payment") || r.compliance.includes("pci")) add("- [ ] Card data is handled by a PCI-compliant processor, never stored here.");
  add("- [ ] Encryption at rest and in transit is on.", "");

  add("## Decommission", "", "1. Export any data you need to keep.", "2. Confirm with the owner. This is irreversible.", "3. Run:", "");
  fence(["cd infra", "tofu destroy"]);
  add("4. Delete leftover secrets, registry images, and DNS records.", "");

  const A: string[] = [];
  const a = (...x: string[]) => A.push(...x);
  a(`# ${appName} agent runbook`, "", `Target: ${c.architecture}, ${c.provider}, ${c.region}. Working directory: repo root. Every step is safe to re-run unless marked.`, "");
  let n = 1;
  const step = (title: string, pre: string, cmds: string[], expect: string, note: string) => {
    a(`${n++}. ${title}`, `   - Precondition: ${pre}`);
    for (const x of cmds) a(`   - Run: \`${x}\``);
    a(`   - Expect: ${expect}`, `   - Idempotency: ${note}`, "");
  };
  step("Check access", "cloud CLI is authenticated", [c.provider === "aws" ? "aws sts get-caller-identity" : c.provider === "gcp" ? "gcloud auth list" : "az account show"], "an identity in the target account", "read-only");
  step("Initialize", "infra/ exists", ["cd infra && tofu init"], "\"Tofu has been successfully initialized\"", "safe to repeat");
  step("Plan", "init done", [`cd infra && tofu plan -out=${appName}.plan`], "exit 0 and a resource summary; no unexpected destroys", "read-only");
  a("   - STOP AND ASK HUMAN: show the plan summary and cost. Continue only on explicit approval.", "");
  step("Apply", "human approved this exact plan file", [`cd infra && tofu apply ${appName}.plan`], "\"Apply complete\"", "re-applying the same plan is a no-op");
  if (s.cmds.some((x) => x.startsWith("helm"))) step("Release", "cluster reachable", s.cmds.filter((x) => x.startsWith("helm")), "release status deployed", "helm upgrade --install is idempotent");
  step("Verify", "apply finished", s.verify, "healthy status and HTTP 200 from the health endpoint", "read-only");
  a(`${n++}. On failure`, "   - Run the rollback commands below, then report to the human.", "");
  fence2(A, s.rollback);
  a("Irreversible actions (stop and ask a human first): applying to prod, destroying resources, rotating or revoking secrets, deleting data or backups.", "", "Never print secret values. Use mock values in the sandbox only.", "");

  return [
    { path: "docs/DEPLOYMENT_HANDBOOK.md", content: L.join("\n"), kind: "docs" },
    { path: "docs/AGENT_RUNBOOK.md", content: A.join("\n"), kind: "docs" },
  ];
}

function fence2(out: string[], cmds: string[]) {
  out.push("```sh", ...cmds, "```", "");
}
