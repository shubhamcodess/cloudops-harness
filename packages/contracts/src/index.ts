import { z } from "zod";

export const Provider = z.enum(["aws", "gcp", "azure"]);
export type Provider = z.infer<typeof Provider>;

export const WorkloadType = z.enum([
  "static-site",
  "service",
  "monolith",
  "microservices",
  "monorepo",
  "package",
  "worker",
  "ai-agent",
  "mcp-server",
  "rag-app",
  "unknown",
]);
export type WorkloadType = z.infer<typeof WorkloadType>;

const Evidence = z.object({ rule: z.string(), file: z.string().optional(), detail: z.string().optional() });

export const ServiceInfo = z.object({
  name: z.string(),
  path: z.string(),
  language: z.string(),
  kind: WorkloadType,
  port: z.number().int().optional(),
  buildCmd: z.string().optional(),
  startCmd: z.string().optional(),
  hasDockerfile: z.boolean(),
});
export type ServiceInfo = z.infer<typeof ServiceInfo>;

export const EnvVarClass = z.enum(["secret", "config", "public"]);

export const RepoProfile = z.object({
  source: z.object({ kind: z.enum(["git", "path"]), ref: z.string() }),
  workloadType: WorkloadType,
  languages: z.array(z.string()),
  packageManager: z.enum(["npm", "pnpm", "yarn", "pip", "poetry", "uv", "maven", "gradle", "go", "cargo", "none"]),
  services: z.array(ServiceInfo),
  dockerable: z.boolean(),
  hasDockerfile: z.boolean(),
  hasCompose: z.boolean(),
  hasHelm: z.boolean(),
  hasTerraform: z.boolean(),
  hasK8sManifests: z.boolean(),
  ci: z.enum(["github-actions", "gitlab-ci", "none"]),
  datastores: z.array(z.enum(["postgres", "mysql", "mongodb", "redis", "sqlite", "s3", "kafka", "rabbitmq", "elasticsearch"])),
  ai: z.object({
    isAi: z.boolean(),
    frameworks: z.array(z.string()),
    modelProviders: z.array(z.string()),
    vectorDbs: z.array(z.string()),
    mcpServer: z.boolean(),
    mcpClient: z.boolean(),
    needsSandbox: z.boolean(),
  }),
  envVars: z.array(z.object({ name: z.string(), classification: EnvVarClass, file: z.string() })),
  pii: z.array(z.object({ signal: z.string(), file: z.string() })),
  evidence: z.array(Evidence),
});
export type RepoProfile = z.infer<typeof RepoProfile>;

export const DataResidency = z.enum(["none", "eu", "us", "in", "uk"]);

export const Requirements = z.object({
  latencyP95Ms: z.number().positive(),
  availabilityTarget: z.number().min(0.9).max(0.99999),
  userRegions: z.array(z.string()).min(1),
  monthlyBudgetUsd: z.number().positive().optional(),
  peakRps: z.number().positive(),
  avgRps: z.number().positive().optional(),
  dataResidency: DataResidency,
  dataClasses: z.array(z.enum(["pii", "special-category", "payment", "none"])),
  compliance: z.array(z.enum(["gdpr", "soc2", "hipaa", "pci"])),
  allowedProviders: z.array(Provider).min(1),
  existing: z
    .object({ provider: Provider, region: z.string(), monthlyCostUsd: z.number().nonnegative(), summary: z.string() })
    .optional(),
  llmTokensPerDay: z.number().nonnegative().optional(),
  llmModel: z.string().optional(),
});
export type Requirements = z.infer<typeof Requirements>;

export const Architecture = z.enum([
  "aws-lambda",
  "aws-ecs-fargate",
  "aws-ec2",
  "aws-eks",
  "aws-s3-cloudfront",
  "gcp-cloud-run",
  "gcp-gke-autopilot",
  "gcp-gce",
  "gcp-gcs-cdn",
  "azure-container-apps",
]);
export type Architecture = z.infer<typeof Architecture>;

export const Sku = z.object({
  provider: Provider,
  service: z.string(),
  skuId: z.string(),
  description: z.string(),
  region: z.string(),
  unit: z.string(),
  unitPrice: z.number().nonnegative(),
  currency: z.string(),
  source: z.string(),
  fetchedAt: z.string(),
});
export type Sku = z.infer<typeof Sku>;

export const CostLine = z.object({
  label: z.string(),
  sku: Sku.optional(),
  quantity: z.number(),
  unit: z.string(),
  monthlyUsd: z.number().nonnegative(),
});

export const Candidate = z.object({
  id: z.string(),
  provider: Provider,
  architecture: Architecture,
  region: z.string(),
  lines: z.array(CostLine),
  monthlyUsd: z.number().nonnegative(),
  estLatencyP95Ms: z.number(),
  estAvailability: z.number(),
  meets: z.object({ latency: z.boolean(), availability: z.boolean(), residency: z.boolean(), budget: z.boolean() }),
  assumptions: z.array(z.string()),
});
export type Candidate = z.infer<typeof Candidate>;

export const CostModel = z.object({ candidates: z.array(Candidate), generatedAt: z.string() });
export type CostModel = z.infer<typeof CostModel>;

export const LedgerEntry = z.object({
  seq: z.number().int(),
  state: z.string(),
  rule: z.string(),
  engine: z.enum(["rule", "llm", "human"]),
  input: z.unknown(),
  output: z.unknown(),
  confidence: z.number().min(0).max(1).optional(),
  prevHash: z.string(),
  hash: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export const Decision = z.object({
  chosenId: z.string(),
  ranked: z.array(z.object({ id: z.string(), score: z.number(), monthlyUsd: z.number() })),
  rejected: z.array(z.object({ id: z.string(), reason: z.string() })),
  savingsVsExistingUsd: z.number().optional(),
  rationale: z.array(z.string()),
});
export type Decision = z.infer<typeof Decision>;

export const GeneratedFile = z.object({
  path: z.string(),
  content: z.string(),
  kind: z.enum(["dockerfile", "terraform", "helm", "ci", "docs", "config", "policy"]),
});
export type GeneratedFile = z.infer<typeof GeneratedFile>;

export const SecretsManifest = z.object({
  store: z.enum(["aws-secrets-manager", "gcp-secret-manager", "vault"]),
  secrets: z.array(z.object({ name: z.string(), rotationDays: z.number(), injection: z.enum(["env", "file", "external-secret"]) })),
  config: z.array(z.object({ name: z.string(), perEnv: z.boolean() })),
});
export type SecretsManifest = z.infer<typeof SecretsManifest>;

export const Check = z.object({
  name: z.string(),
  status: z.enum(["pass", "fail", "skipped"]),
  evidence: z.string(),
  durationMs: z.number().optional(),
});
export const ProofReport = z.object({
  checks: z.array(Check),
  planCostUsd: z.number().optional(),
  verdict: z.enum(["verified", "partial", "failed"]),
});
export type ProofReport = z.infer<typeof ProofReport>;

export const RunStage = z.enum(["created", "profiled", "requirements", "priced", "decided", "generated", "verified", "delivered"]);
export type RunStage = z.infer<typeof RunStage>;

export const RunView = z.object({
  id: z.string(),
  createdAt: z.string(),
  stage: RunStage,
  appName: z.string(),
  source: z.string(),
  profile: RepoProfile.optional(),
  requirements: Requirements.optional(),
  candidates: z.array(Candidate).optional(),
  decision: Decision.optional(),
  files: z.array(z.object({ path: z.string(), kind: z.string(), bytes: z.number() })).optional(),
  proof: ProofReport.optional(),
  compliance: z.array(z.object({ rule: z.string(), severity: z.string(), message: z.string() })).optional(),
  savings: z.object({ baselineMonthlyUsd: z.number(), chosenMonthlyUsd: z.number(), savedMonthlyUsd: z.number(), savedPct: z.number() }).optional(),
  deliveries: z.array(z.object({ mode: z.string(), target: z.string(), at: z.string() })).optional(),
  ledger: z.array(LedgerEntry),
});
export type RunView = z.infer<typeof RunView>;
