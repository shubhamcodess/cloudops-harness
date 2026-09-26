import type { Candidate, RepoProfile, Requirements, SecretsManifest } from "@smc/contracts";

export const nodeProfile = (over: Partial<RepoProfile> = {}): RepoProfile => ({
  source: { kind: "git", ref: "https://example.com/repo.git" },
  workloadType: "service",
  languages: ["typescript", "node"],
  packageManager: "pnpm",
  services: [
    { name: "api", path: "apps/api", language: "typescript", kind: "service", port: 8080, startCmd: "node dist/index.js", hasDockerfile: false },
  ],
  dockerable: true,
  hasDockerfile: false,
  hasCompose: false,
  hasHelm: false,
  hasTerraform: false,
  hasK8sManifests: false,
  ci: "github-actions",
  datastores: ["postgres"],
  ai: { isAi: false, frameworks: [], modelProviders: [], vectorDbs: [], mcpServer: false, mcpClient: false, needsSandbox: false },
  envVars: [{ name: "DATABASE_URL", classification: "secret", file: ".env" }],
  pii: [],
  evidence: [],
  ...over,
});

export const staticProfile = (): RepoProfile => ({
  ...nodeProfile(),
  workloadType: "static-site",
  services: [{ name: "web", path: ".", language: "typescript", kind: "static-site", port: 80, hasDockerfile: false }],
  datastores: [],
});

export const pyProfile = (): RepoProfile => ({
  ...nodeProfile(),
  languages: ["python"],
  packageManager: "pip",
  services: [{ name: "api", path: ".", language: "python", kind: "service", port: 8000, startCmd: "gunicorn -b 0.0.0.0:8000 app:app", hasDockerfile: false }],
});

export const reqs = (over: Partial<Requirements> = {}): Requirements => ({
  latencyP95Ms: 500,
  availabilityTarget: 0.995,
  userRegions: ["us-east-1"],
  monthlyBudgetUsd: 200,
  peakRps: 50,
  dataResidency: "us",
  dataClasses: ["pii"],
  compliance: ["soc2"],
  allowedProviders: ["aws", "gcp"],
  ...over,
});

export const awsEcsCandidate = (): Candidate => ({
  id: "aws-ecs-1",
  provider: "aws",
  architecture: "aws-ecs-fargate",
  region: "us-east-1",
  lines: [],
  monthlyUsd: 120,
  estLatencyP95Ms: 300,
  estAvailability: 0.999,
  meets: { latency: true, availability: true, residency: true, budget: true },
  assumptions: [],
});

export const awsLambdaCandidate = (): Candidate => ({
  ...awsEcsCandidate(),
  id: "aws-lambda-1",
  architecture: "aws-lambda",
});

export const awsSiteCandidate = (): Candidate => ({
  ...awsEcsCandidate(),
  id: "aws-site-1",
  architecture: "aws-s3-cloudfront",
});

export const gcpRunCandidate = (): Candidate => ({
  ...awsEcsCandidate(),
  id: "gcp-run-1",
  provider: "gcp",
  architecture: "gcp-cloud-run",
  region: "us-central1",
});

export const gcpSiteCandidate = (): Candidate => ({
  ...gcpRunCandidate(),
  id: "gcp-site-1",
  architecture: "gcp-gcs-cdn",
});

export const secrets = (): SecretsManifest => ({
  store: "aws-secrets-manager",
  secrets: [
    { name: "DATABASE_URL", rotationDays: 30, injection: "external-secret" },
    { name: "OPENAI_API_KEY", rotationDays: 90, injection: "external-secret" },
  ],
  config: [{ name: "APP_NAME", perEnv: false }],
});
